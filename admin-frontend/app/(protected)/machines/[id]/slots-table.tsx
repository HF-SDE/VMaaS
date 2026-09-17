"use client"

import * as React from "react"
import { Search, Settings2 } from "lucide-react"

import {
  DataTable,
  type DataTableInstance,
} from "@/components/data-table-generic"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { slotColumnNames, slotColumns, type SlotListItem } from "./slot-columns"

/**
 * The slots of one machine, sorted and filtered in the browser.
 *
 * Everything the products and machines tables do over the network, this does in
 * memory: a machine holds a few dozen slots at most, so they all arrive with the
 * page and there is nothing to page through. That is what makes this the plain
 * version — no URL params, no debounce, no fetching, no loading state. Sorting
 * is `<DataTable>`'s own internal state, and `showPagination={false}` puts every
 * row on one page.
 *
 * The search is a `useMemo` over the array rather than tanstack's global filter:
 * the feature is not registered in `dataTableFeatures`, and for two fields this
 * is the shorter of the two.
 */
export function SlotsTable({ slots }: { slots: SlotListItem[] }) {
  const [search, setSearch] = React.useState("")

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return slots

    return slots.filter(
      (slot) =>
        slot.product.name.toLowerCase().includes(query) ||
        String(slot.slotNumber).includes(query)
    )
  }, [slots, search])

  const toolbar = (table: DataTableInstance<SlotListItem>) => (
    <div className="flex items-center justify-between gap-2">
      <div className="relative w-full max-w-sm">
        <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search slots..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="h-8" />}
        >
          <Settings2 className="mr-2 h-4 w-4" />
          Columns
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {table
            .getAllColumns()
            .filter((column) => column.getCanHide())
            .map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {slotColumnNames[column.id] || column.id}
              </DropdownMenuCheckboxItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <DataTable
      columns={slotColumns}
      data={filtered}
      showPagination={false}
      toolbar={toolbar}
    />
  )
}
