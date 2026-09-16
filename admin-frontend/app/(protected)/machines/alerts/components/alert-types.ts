import { ALERT_TYPES, type AlertType } from "@vmaas/shared/types/machineAlert"

export { ALERT_TYPES, type AlertType }

export type Filters = {
  alertTypes: AlertType[]
  machineIds: string[]
  siteIds: string[]
  dateFrom: string | null
  dateTo: string | null
}

export const EMPTY_FILTERS: Filters = {
  alertTypes: [],
  machineIds: [],
  siteIds: [],
  dateFrom: null,
  dateTo: null,
}

export const alertTypeLabels: Record<AlertType, string> = {
  tamper: "Tamper",
  offline: "Offline",
  error: "Error",
}

export const alertTypeStyles: Record<AlertType, string> = {
  tamper: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  offline: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  error: "bg-red-500/10 text-red-600 dark:text-red-400",
}

export function activeFilterCount(filters: Filters): number {
  return (
    filters.alertTypes.length +
    filters.machineIds.length +
    filters.siteIds.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0)
  )
}
