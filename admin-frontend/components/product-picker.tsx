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
import { formatPrice } from "@/lib/utils"
import type { SimpleProduct } from "@vmaas/shared/types/product"

/** One character is enough: a tenant has tens of products, not millions. */
const MIN_QUERY_LENGTH = 1

const DEBOUNCE_MS = 300

type ProductPickerProps = {
  /** Called with the picked product, or `null` when the selection is cleared. */
  onSelect: (product: SimpleProduct | null) => void
  /** Pre-fills the input, for editing a slot that already has a product. */
  defaultValue?: string
  placeholder?: string
  /** Set this to the `htmlFor` of the surrounding `<FieldLabel>`. */
  id?: string
  name?: string
  disabled?: boolean
  className?: string
}

/**
 * A product autocomplete backed by `GET /api/products/simple-search`, for the
 * forms that point at a product.
 *
 * The endpoint is tenant-scoped server-side (`requireAuth → requireTenant`), so
 * this sends nothing but the query — a product of another tenant is never a
 * suggestion, and an archived one is never suggested at all.
 *
 * `filter={null}` turns off Base UI's client-side filtering: the server already
 * decided what matches, and re-filtering here would only drop rows the server
 * meant to return.
 */
export function ProductPicker({
  onSelect,
  defaultValue = "",
  placeholder = "Search for a product",
  id,
  name,
  disabled = false,
  className,
}: ProductPickerProps) {
  const [query, setQuery] = useState(defaultValue)
  const [results, setResults] = useState<SimpleProduct[]>([])
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

    fetchData<SimpleProduct[]>("/api/products/simple-search", {
      query: { search: trimmed },
    }).then(([error, products]) => {
      if (cancelled) return

      // A failed lookup only empties the suggestions — the empty state says so,
      // and the surrounding form stays usable.
      setResults(error ? [] : products)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  function handleSelect(product: SimpleProduct | null) {
    skipQueryRef.current = product?.name ?? null
    onSelect(product)
  }

  const emptyMessage = isLoading
    ? "Searching…"
    : query.trim().length < MIN_QUERY_LENGTH
      ? "Type to search for a product."
      : "No products found."

  return (
    <Combobox
      items={results}
      filter={null}
      inputValue={query}
      onInputValueChange={(value) => setQuery(value)}
      onValueChange={handleSelect}
      itemToStringLabel={(product: SimpleProduct) => product.name}
      isItemEqualToValue={(a: SimpleProduct, b: SimpleProduct) => a.id === b.id}
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
          {(product: SimpleProduct) => (
            <ComboboxItem
              key={product.id}
              value={product}
              className="flex-col items-start gap-0.5"
            >
              <span className="truncate">{product.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {formatPrice(product.price)}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
