"use server"

import { requireAccess, requireUser } from "@/lib/dal"
import type { CreateTenantFormData } from "@/lib/tenant-form"
import { Tenant } from "@prisma"
import { fetchData } from "@/lib/data/data-fetch"
import { err, ok, Result, HttpError } from "@vmaas/shared/lib/error-handling"
import { refresh, updateTag } from "next/cache"
import { redirect } from "next/navigation"

/** `null` clears the active organization, which is how a user stuck on a locked
 *  organization gets back to the picker. */
export async function switchTenant(
  tenantId: string | null
): Promise<Result<HttpError, unknown>> {
  // Signed in is enough: a user with no active tenant yet is exactly who needs
  // to switch. requireAccess() here would bounce them straight back to
  // /onboarding, which is the page doing the switching.
  await requireUser()

  // The backend verifies membership via isTenantMember, so a 403 here is correct.
  const [error, data] = await fetchData("/api/auth/tenant/switch", {
    method: "POST",
    body: { tenantId },
  })
  if (error) return err(error)

  updateTag("tenants") // the session's activeTenantId changed
  refresh() // refresh current client route

  return ok(data)
}

export async function createTenant(data: CreateTenantFormData): Promise<void> {
  const [error, result] = await fetchData<Tenant>("/api/tenants", {
    method: "POST",
    body: data,
  })

  if (error) throw error

  await switchTenant(result.id) // also invalidates the tenant/session caches

  // Navigate from the action itself. Leaving it to switchTenant's refresh()
  // re-renders /onboarding into a render-time redirect, which in a production
  // build loops between /onboarding and / instead of reaching /billing.
  redirect("/")
}

export async function resolveAlert(
  alertId: string
): Promise<Result<HttpError, unknown>> {
  // The gate is here for the tenant, not for the permission: the backend
  // re-checks ALERT_RESOLVE, and <RoleGate> only decides whether the button
  // renders. Neither is a substitute for the other.
  await requireAccess()

  const [error, data] = await fetchData(`/api/alerts/${alertId}/resolve`, {
    method: "PATCH",
  })
  if (error) return err(error)

  // refresh(), not revalidatePath(): every dashboard section reads through
  // fetchData, which is no-store, so there is no cached entry to invalidate —
  // what went stale is the client router's copy of this route.
  refresh()

  return ok(data)
}
