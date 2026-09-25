import "server-only"
import { fetchData } from "./data-fetch"
import type { LowStockSlot } from "@vmaas/shared/types/slot"
import type { HttpError, Result } from "@vmaas/shared/lib/error-handling"

/** Tenant scope rides on the session's activeTenantId; the backend re-checks
 *  MACHINE_READ, so there is nothing to pass and nothing to trust from a caller. */
export async function getLowStockSlots(): Promise<
  Result<HttpError, LowStockSlot[]>
> {
  return fetchData<LowStockSlot[]>("/api/slots/low-stock")
}
