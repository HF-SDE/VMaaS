"use client"

import { useEffect, useRef, useState } from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { InputGroupAddon } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { useDebounce } from "@/hooks/use-debounce"

/** Photon is Komoot's public geocoder over OpenStreetMap. No key, no quota to
 *  configure — but also no SLA, which is why a failed lookup only disables the
 *  suggestions and never blocks the surrounding form. */
const PHOTON_URL = "https://photon.komoot.io/api/"

/** Below this, a query matches most of the planet and the results are noise. */
const MIN_QUERY_LENGTH = 3

const DEBOUNCE_MS = 500

/**
 * The subset of Photon's `properties` this component reads. Every field is
 * optional in the API: a house has a `street` and a `housenumber`, a city
 * feature has neither and carries its `name` instead.
 */
type PhotonProperties = {
  osm_id?: number
  osm_type?: string
  name?: string
  housenumber?: string
  street?: string
  city?: string
  district?: string
  locality?: string
  state?: string
  postcode?: string
  country?: string
  countrycode?: string
}

type PhotonFeature = {
  properties?: PhotonProperties
  /** GeoJSON, so the pair is `[longitude, latitude]` — not the other way round. */
  geometry?: { type?: string; coordinates?: number[] }
}

type PhotonResponse = { features?: PhotonFeature[] }

/**
 * One selectable address, flattened out of a Photon feature.
 *
 * The field names line up with the `Site` columns (`addressLine1`, `postcode`,
 * `city`, `countryCode`, `latitude`, `longitude`) so a caller can hand the
 * selection more or less straight to a form.
 */
export type AddressSuggestion = {
  /** Stable within one result set — React key and selected-item comparison. */
  id: string
  /** Single line, and what fills the input once the item is picked. */
  label: string
  street?: string
  housenumber?: string
  /** `street` and `housenumber` joined, e.g. `"Kullinggade 6A"`. */
  addressLine1?: string
  postcode?: string
  city?: string
  state?: string
  country?: string
  countryCode?: string
  latitude: number
  longitude: number
}

function joinParts(...parts: Array<string | undefined>): string | undefined {
  const present = parts.filter((part) => part && part.trim().length > 0)
  return present.length > 0 ? present.join(" ") : undefined
}

/** `"Kullinggade 6A, 5700 Svendborg, Region of Southern Denmark"`. */
function formatLabel(address: {
  addressLine1?: string
  postcode?: string
  city?: string
  state?: string
}): string {
  return [
    address.addressLine1,
    joinParts(address.postcode, address.city),
    address.state,
  ]
    .filter(Boolean)
    .join(", ")
}

/**
 * Returns `null` for a feature without usable coordinates — a geocoding result
 * that cannot be placed on a map is of no use to a caller that asked for one.
 */
function toSuggestion(
  feature: PhotonFeature,
  index: number
): AddressSuggestion | null {
  const [longitude, latitude] = feature.geometry?.coordinates ?? []
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null
  }

  const properties = feature.properties ?? {}
  // A house carries `street`; a street, city or POI carries `name`.
  const street = properties.street ?? properties.name
  const addressLine1 = joinParts(street, properties.housenumber)

  const address = {
    street,
    housenumber: properties.housenumber,
    addressLine1,
    postcode: properties.postcode,
    city: properties.city ?? properties.locality ?? properties.district,
    state: properties.state,
    country: properties.country,
    countryCode: properties.countrycode,
  }

  const label = formatLabel(address)
  if (!label) {
    return null
  }

  return {
    // Photon can return the same OSM object twice across result pages, and a
    // feature may have no id at all, so the index is part of the key.
    id: `${properties.osm_type ?? "?"}${properties.osm_id ?? "?"}-${index}`,
    label,
    ...address,
    latitude,
    longitude,
  }
}

type SearchStatus = "idle" | "loading" | "error" | "done"

type AddressSearchProps = {
  /**
   * Called with the picked address — street parts, postcode, city, state and
   * its `latitude` / `longitude` — or with `null` when the selection is
   * cleared.
   */
  onSelect: (address: AddressSuggestion | null) => void
  /** Pre-fills the input, for editing an address that is already stored. */
  defaultValue?: string
  placeholder?: string
  /** Set this to the `htmlFor` of the surrounding `<FieldLabel>`. */
  id?: string
  name?: string
  disabled?: boolean
  /** How many suggestions to request. Photon's own default is 10. */
  limit?: number
  className?: string
}

/**
 * An address autocomplete backed by Photon (OpenStreetMap).
 *
 * The input is debounced rather than throttled: typing an address is bursty, and
 * only the pause at the end is worth a request. Each keystroke after the pause
 * aborts the request in flight, so a slow early response can never overwrite the
 * results of a later query.
 *
 * `filter={null}` turns off Base UI's client-side filtering. The server already
 * decided what matches, and re-filtering the labels against the raw input would
 * throw away results whose formatting differs from what the user typed.
 */
export function AddressSearch({
  onSelect,
  defaultValue = "",
  placeholder = "Search for an address",
  id,
  name,
  disabled = false,
  limit = 8,
  className,
}: AddressSearchProps) {
  const [query, setQuery] = useState(defaultValue)
  const [results, setResults] = useState<AddressSuggestion[]>([])
  const [status, setStatus] = useState<SearchStatus>("idle")
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS)

  /**
   * Picking an item writes its label into the input, which would otherwise be
   * searched right back — a pointless request whose only visible effect is a
   * spinner after a completed selection. The label is parked here so the next
   * run of the effect skips exactly that one query, and cleared immediately so
   * retyping the same text still searches.
   */
  const skipQueryRef = useRef<string | null>(null)

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    const skipped = skipQueryRef.current === trimmed
    skipQueryRef.current = null

    if (skipped) {
      return
    }

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setStatus("idle")
      return
    }

    const controller = new AbortController()
    setStatus("loading")

    async function search() {
      try {
        const url = `${PHOTON_URL}?q=${encodeURIComponent(trimmed)}&limit=${limit}&lang=en`
        const response = await fetch(url, { signal: controller.signal })

        if (!response.ok) {
          throw new Error(`Photon answered ${response.status}`)
        }

        const data: PhotonResponse = await response.json()
        const suggestions = (data.features ?? [])
          .map(toSuggestion)
          .filter((item): item is AddressSuggestion => item !== null)

        setResults(suggestions)
        setStatus("done")
      } catch {
        // An abort is this effect cleaning up after itself, not a failure:
        // another query is already on its way and owns the state now.
        if (controller.signal.aborted) {
          return
        }

        setResults([])
        setStatus("error")
      }
    }

    search()

    return () => controller.abort()
  }, [debouncedQuery, limit])

  function handleSelect(address: AddressSuggestion | null) {
    skipQueryRef.current = address?.label ?? null
    onSelect(address)
  }

  const emptyMessage =
    status === "loading"
      ? "Searching…"
      : status === "error"
        ? "Address lookup is unavailable right now."
        : query.trim().length < MIN_QUERY_LENGTH
          ? `Type at least ${MIN_QUERY_LENGTH} characters to search.`
          : "No addresses found."

  return (
    <Combobox
      items={results}
      filter={null}
      inputValue={query}
      onInputValueChange={(value) => setQuery(value)}
      onValueChange={handleSelect}
      itemToStringLabel={(address: AddressSuggestion) => address.label}
      isItemEqualToValue={(a: AddressSuggestion, b: AddressSuggestion) =>
        a.id === b.id
      }
      disabled={disabled}
      name={name}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        showTrigger={false}
        autoComplete="off"
        className={className}
      >
        {status === "loading" && (
          <InputGroupAddon align="inline-end">
            <Spinner className="text-muted-foreground" />
          </InputGroupAddon>
        )}
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList>
          {(address: AddressSuggestion) => (
            <ComboboxItem
              key={address.id}
              value={address}
              className="flex-col items-start gap-0.5"
            >
              <span className="truncate">
                {address.addressLine1 ?? address.label}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {[joinParts(address.postcode, address.city), address.state]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
