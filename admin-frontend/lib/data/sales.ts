import "server-only"
import { fetchData } from "./data-fetch"
import type { SalesSummary } from "@vmaas/shared/types/sale"
import type { HttpError, Result } from "@vmaas/shared/lib/error-handling"

/** No `days`: the endpoint's own default is what the heading names, so passing
 *  it here would be two places to change it — same reason the map read omits it. */
export async function getSalesSummary(): Promise<
  Result<HttpError, SalesSummary>
> {
  return fetchData<SalesSummary>("/api/sales/summary")
}
