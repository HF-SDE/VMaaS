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
import { fetchData } from "@/lib/data/data-fetch"
import type { SimpleSite } from "@vmaas/shared/types/site"

/** One character is enough: a tenant has tens of sites, not millions. */
const MIN_QUERY_LENGTH = 1

const DEBOUNCE_MS = 300

type SitePickerProps = {
  /** Called with the picked site, or `null` when the selection is cleared. */
  onSelect: (site: SimpleSite | null) => void
  /** Pre-fills the input, for editing a machine that already has a site. */
  defaultValue?: string
  placeholder?: string
  /** Set this to the `htmlFor` of the surrounding `<FieldLabel>`. */
  id?: string
  name?: string
  disabled?: boolean
  className?: string
}

/**
 * A site autocomplete backed by `GET /api/sites/simple-search`, for the machine
 * form's site field.
 *
 * The endpoint is tenant-scoped server-side (`requireAuth → requireTenant`), so
 * this sends nothing but the query — a site of another tenant is never a
 * suggestion.
 *
 * `filter={null}` turns off Base UI's client-side filtering: the server already
 * decided what matches, and a site found by its city would otherwise be dropped
 * because its name does not contain what the user typed.
 */
export function SitePicker({
  onSelect,
  defaultValue = "",
  placeholder = "Search for a site",
  id,
  name,
  disabled = false,
  className,
}: SitePickerProps) {
  const [query, setQuery] = useState(defaultValue)
  const [results, setResults] = useState<SimpleSite[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS)

  /**
   * Picking an item writes its name into the input, which would otherwise be
   * searched right back — a pointless request whose only visible effect is a
   * spinner after a completed selection. The name is parked here so the next run
   * of the effect skips exactly that one query, and cleared immediately so
   * retyping the same text still searches.
   */
  const skipQueryRef = useRef<string | null>(null)

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    const skipped = skipQueryRef.current === trimmed
    skipQueryRef.current = null

    if (skipped) return

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      return
    }

    // `fetchData` takes no abort signal, so a slow early response is discarded
    // on cleanup instead: without this, it could land after a later query's and
    // leave the list showing results for text the user has already replaced.
    let cancelled = false
    setIsLoading(true)

    fetchData<SimpleSite[]>("/api/sites/simple-search", {
      query: { search: trimmed },
    }).then(([error, sites]) => {
      if (cancelled) return

      // A failed lookup only empties the suggestions — the empty state says so,
      // and the surrounding form stays usable.
      setResults(error ? [] : sites)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  function handleSelect(site: SimpleSite | null) {
    skipQueryRef.current = site?.name ?? null
    onSelect(site)
  }

  const emptyMessage = isLoading
    ? "Searching…"
    : query.trim().length < MIN_QUERY_LENGTH
      ? "Type to search for a site."
      : "No sites found."

  return (
    <Combobox
      items={results}
      filter={null}
      inputValue={query}
      onInputValueChange={(value) => setQuery(value)}
      onValueChange={handleSelect}
      itemToStringLabel={(site: SimpleSite) => site.name}
      isItemEqualToValue={(a: SimpleSite, b: SimpleSite) => a.id === b.id}
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
        {isLoading && (
          <InputGroupAddon align="inline-end">
            <Spinner className="text-muted-foreground" />
          </InputGroupAddon>
        )}
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList>
          {(site: SimpleSite) => (
            <ComboboxItem
              key={site.id}
              value={site}
              className="flex-col items-start gap-0.5"
            >
              <span className="truncate">{site.name}</span>
              {site.city && (
                <span className="truncate text-xs text-muted-foreground">
                  {site.city}
                </span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
