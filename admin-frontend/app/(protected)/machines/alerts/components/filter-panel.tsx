"use client"

import * as React from "react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { EMPTY_FILTERS, type Filters, activeFilterCount } from "./alert-types"
import {
  AlertTypeFilter,
  alertTypeFilterCount,
} from "./filters/alert-type-filter"
import { MachineFilter, machineFilterCount } from "./filters/machine-filter"
import { SiteFilter, siteFilterCount } from "./filters/site-filter"
import {
  TimeRangeFilter,
  timeRangeFilterCount,
} from "./filters/time-range-filter"

function FilterBadge({ count }: { count: number }) {
  if (count === 0) return null

  return (
    <Badge className="ml-auto h-5 min-w-5 shrink-0 rounded-full px-1.5 text-xs">
      {count}
    </Badge>
  )
}

function FilterSection({
  value,
  title,
  count,
  onClear,
  children,
}: {
  value: string
  title: string
  count: number
  onClear: () => void
  children: React.ReactNode
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:no-underline">
        <span>{title}</span>
        <FilterBadge count={count} />
      </AccordionTrigger>
      <AccordionContent className="px-4">
        <div className="flex flex-col gap-2">
          {count > 0 && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="h-5 px-1.5 text-xs text-muted-foreground"
              >
                Clear
              </Button>
            </div>
          )}
          {children}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

export function FilterPanel({
  filters,
  onChange,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Filters</h3>
        {activeFilterCount(filters) > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="h-6 text-xs"
          >
            Clear all
          </Button>
        )}
      </div>

      {/* Base UI spells this `multiple`, not Radix's `type="multiple"` — every
          section is open by default and any of them can be closed. */}
      <Accordion
        multiple
        className="rounded-none border-0"
        defaultValue={["time", "machines", "sites", "types"]}
      >
        <FilterSection
          value="time"
          title="Time range"
          count={timeRangeFilterCount(filters)}
          onClear={() => onChange({ ...filters, dateFrom: null, dateTo: null })}
        >
          <TimeRangeFilter filters={filters} onChange={onChange} />
        </FilterSection>

        <FilterSection
          value="machines"
          title="Machines"
          count={machineFilterCount(filters)}
          onClear={() => onChange({ ...filters, machineIds: [] })}
        >
          <MachineFilter filters={filters} onChange={onChange} />
        </FilterSection>

        <FilterSection
          value="sites"
          title="Sites"
          count={siteFilterCount(filters)}
          onClear={() => onChange({ ...filters, siteIds: [] })}
        >
          <SiteFilter filters={filters} onChange={onChange} />
        </FilterSection>

        <FilterSection
          value="types"
          title="Alert type"
          count={alertTypeFilterCount(filters)}
          onClear={() => onChange({ ...filters, alertTypes: [] })}
        >
          <AlertTypeFilter filters={filters} onChange={onChange} />
        </FilterSection>
      </Accordion>
    </div>
  )
}
