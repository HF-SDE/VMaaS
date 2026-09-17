"use client"

import { searchSites } from "@/lib/data/pickers"
import type { Filters } from "../alert-types"
import { EntityPicker, type PickerOption } from "./entity-picker"

/** The city is the hint — `SimpleSite` carries it for exactly this reason, to
 *  separate two sites sharing a name. It is nullable, and an absent city simply
 *  shows no hint. */
async function search(query: string): Promise<PickerOption[]> {
  const sites = await searchSites(query)

  return sites.map((site) => ({
    id: site.id,
    label: site.name,
    hint: site.city,
  }))
}

export function SiteFilter({
  filters,
  onChange,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
}) {
  return (
    <EntityPicker
      value={filters.siteIds}
      onValueChange={(siteIds) => onChange({ ...filters, siteIds })}
      search={search}
      placeholder="Search sites..."
      emptyText="No sites found."
    />
  )
}

export function siteFilterCount(filters: Filters): number {
  return filters.siteIds.length
}
