"use server"

import { requireUser } from "@/lib/dal"
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
