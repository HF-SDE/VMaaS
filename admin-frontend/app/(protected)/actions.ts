"use server"

import { requireTenant, requireUser } from "@/lib/dal"
import { CreateTenantFormData } from "../(auth)/welcome/client"
import { Tenant } from "@prisma"
import { fetchData } from "@/lib/data/data-fetch"
import { err, ok, Result, HttpError } from "@vmaas/shared/lib/error-handling"
import { refresh, updateTag } from "next/cache"

export async function switchTenant(
  tenantId: string
): Promise<Result<HttpError, unknown>> {
  // Signed in is enough: a user with no active tenant yet is exactly who needs
  // to switch. requireTenant() here would bounce them straight back to /welcome.
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
}

export async function resolveAlert(
  alertId: string
): Promise<Result<HttpError, unknown>> {
  // The gate is here for the tenant, not for the permission: the backend
  // re-checks ALERT_RESOLVE, and <RoleGate> only decides whether the button
  // renders. Neither is a substitute for the other.
  await requireTenant()

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
