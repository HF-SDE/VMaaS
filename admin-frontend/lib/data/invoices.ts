import { fetchData } from "./data-fetch"
import type { HttpError, Result } from "@vmaas/shared/lib/error-handling"
import type { TenantInvoicePage } from "@vmaas/shared/types/invoice"

/**
 * One page of the active tenant's receipts, newest first.
 *
 * Tenant scope rides on the session's `activeTenantId` and the backend re-checks
 * that the caller owns it, so the cursor is the only thing worth passing.
 * `startingAfter` is the previous page's `nextCursor` — an opaque Stripe
 * invoice id, never an offset.
 */
export async function getInvoicesPage(
  params: { limit?: number; startingAfter?: string } = {}
): Promise<Result<HttpError, TenantInvoicePage>> {
  return fetchData<TenantInvoicePage>("/api/subscriptions/invoices", {
    query: { limit: params.limit, startingAfter: params.startingAfter },
  })
}
