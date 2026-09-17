"use client"

import * as React from "react"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { useDebounce } from "@/hooks/use-debounce"

export type PickerOption = {
  id: string
  label: string
  hint?: string | null
}

export function EntityPicker({
  value,
  onValueChange,
  search,
  placeholder,
  emptyText,
}: {
  value: string[]
  onValueChange: (ids: string[]) => void
  search: (query: string) => Promise<PickerOption[]>
  placeholder: string
  emptyText: string
}) {
  const [options, setOptions] = React.useState<PickerOption[]>([])
  const [searchInput, setSearchInput] = React.useState("")
  const debouncedSearch = useDebounce(searchInput, 300)
  const anchor = useComboboxAnchor()

  const requestSequence = React.useRef(0)
  const [labels, setLabels] = React.useState(
    () => new Map<string, PickerOption>()
  )

  React.useEffect(() => {
    const query = debouncedSearch.trim()

    if (!query) {
      setOptions([])
      return
    }

    const requestId = ++requestSequence.current

    search(query).then((next) => {
      if (requestSequence.current !== requestId) return

      setLabels((prev) => {
        const merged = new Map(prev)
        for (const option of next) merged.set(option.id, option)
        return merged
      })
      setOptions(next)
    })
  }, [debouncedSearch, search])

  const labelFor = (id: string) => labels.get(id)?.label ?? id

  return (
    <Combobox
      items={options.map((option) => option.id)}
      value={value}
      onValueChange={(ids) => onValueChange(ids ?? [])}
      itemToStringLabel={labelFor}
      onInputValueChange={setSearchInput}
      openOnInputClick
      autoHighlight
      multiple
    >
      <ComboboxChips ref={anchor} className="w-full rounded-lg">
        {value.map((id) => (
          <ComboboxChip key={id}>{labelFor(id)}</ComboboxChip>
        ))}
        <ComboboxChipsInput placeholder={placeholder} />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>
          {debouncedSearch.trim() ? emptyText : "Start typing to search."}
        </ComboboxEmpty>
        <ComboboxList>
          {(id: string) => {
            const option = labels.get(id)
            return (
              <ComboboxItem key={id} value={id}>
                <span className="truncate">{option?.label ?? id}</span>
                {option?.hint && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </ComboboxItem>
            )
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
