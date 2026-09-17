"use client"

import { searchMachines } from "@/lib/data/pickers"
import type { Filters } from "../alert-types"
import { EntityPicker, type PickerOption } from "./entity-picker"

/** The site is the hint: two machines at different sites are often given the
 *  same name, and the id alone tells the user nothing. */
async function search(query: string): Promise<PickerOption[]> {
  const machines = await searchMachines(query)

  return machines.map((machine) => ({
    id: machine.id,
    label: machine.name,
    hint: machine.site.name,
  }))
}

export function MachineFilter({
  filters,
  onChange,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
}) {
  return (
    <EntityPicker
      value={filters.machineIds}
      onValueChange={(machineIds) => onChange({ ...filters, machineIds })}
      search={search}
      placeholder="Search machines..."
      emptyText="No machines found."
    />
  )
}

export function machineFilterCount(filters: Filters): number {
  return filters.machineIds.length
}
