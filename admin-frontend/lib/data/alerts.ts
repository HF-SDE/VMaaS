import { fetchData } from "./data-fetch"
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table"
import type {
  AlertsSummary,
  AlertType,
  MachineAlertRow,
} from "@vmaas/shared/types/machineAlert"
import type { HttpError, Result } from "@vmaas/shared/lib/error-handling"

export type AlertQuery = {
  page: number
  pageSize: number
  search?: string
  machineIds?: string[]
  siteIds?: string[]
  alertTypes?: AlertType[]
  dateFrom?: string
  dateTo?: string
}

function joinIds(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined
}

export async function getAlertsPage(
  params: AlertQuery
): Promise<Result<HttpError, GetPaginatedResult<MachineAlertRow>>> {
  return fetchData<GetPaginatedResult<MachineAlertRow>>(
    "/api/alerts/paginated",
    {
      query: {
        page: params.page,
        pageSize: params.pageSize,
        search: params.search || undefined,
        machineIds: joinIds(params.machineIds),
        siteIds: joinIds(params.siteIds),
        alertTypes: joinIds(params.alertTypes),
        dateFrom: params.dateFrom || undefined,
        dateTo: params.dateTo || undefined,
      },
    }
  )
}

/** Tenant scope rides on the session's activeTenantId; the backend re-checks
 *  ALERT_READ, so there is nothing to pass and nothing to trust from a caller. */
export async function getAlertsSummary(): Promise<
  Result<HttpError, AlertsSummary>
> {
  return fetchData<AlertsSummary>("/api/alerts/summary")
}
