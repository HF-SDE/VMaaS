"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Filters } from "../alert-types"

/** Both bounds are inclusive whole days, and each input constrains the other so
 *  the range cannot be inverted in the UI. The endpoint reads them in UTC. */
export function TimeRangeFilter({
  filters,
  onChange,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input
          type="date"
          value={filters.dateFrom ?? ""}
          max={filters.dateTo ?? undefined}
          onChange={(e) =>
            onChange({ ...filters, dateFrom: e.target.value || null })
          }
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input
          type="date"
          value={filters.dateTo ?? ""}
          min={filters.dateFrom ?? undefined}
          onChange={(e) =>
            onChange({ ...filters, dateTo: e.target.value || null })
          }
          className="h-8 text-sm"
        />
      </div>
    </div>
  )
}

export function timeRangeFilterCount(filters: Filters): number {
  return (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0)
}
