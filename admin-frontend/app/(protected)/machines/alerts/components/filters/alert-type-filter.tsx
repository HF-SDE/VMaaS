"use client"

import { Checkbox } from "@/components/ui/checkbox"
import {
  ALERT_TYPES,
  type AlertType,
  type Filters,
  alertTypeLabels,
} from "../alert-types"

export function AlertTypeFilter({
  filters,
  onChange,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
}) {
  const toggle = (type: AlertType) => {
    const alertTypes = filters.alertTypes.includes(type)
      ? filters.alertTypes.filter((selected) => selected !== type)
      : [...filters.alertTypes, type]

    onChange({ ...filters, alertTypes })
  }

  return (
    <div className="flex flex-col gap-2">
      {ALERT_TYPES.map((type) => (
        <label
          key={type}
          className="flex cursor-pointer items-center gap-2.5 text-sm"
        >
          <Checkbox
            checked={filters.alertTypes.includes(type)}
            onCheckedChange={() => toggle(type)}
          />
          <span>{alertTypeLabels[type]}</span>
        </label>
      ))}
    </div>
  )
}

export function alertTypeFilterCount(filters: Filters): number {
  return filters.alertTypes.length
}
