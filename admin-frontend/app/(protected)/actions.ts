"use server"

import { requireTenant } from "@/lib/dal"
import { CreateTenantFormData } from "../(auth)/welcome/client"
import { Tenant } from "@prisma"
import { fetchData } from "@/lib/data/data-fetch"

export async function switchTenant(tenantId: string): Promise<void> {
  await requireTenant() //this will redirect if the user is not part of a tenant

  // The backend verifies membership via isTenantMember, so a 403 here is correct.
  const [error] = await fetchData("/api/auth/tenant/switch", {
    method: "POST",
    body: { tenantId },
  })
}

export async function createTenant(data: CreateTenantFormData): Promise<void> {
  const [error, result] = await fetchData<Tenant>("/api/tenants", {
    method: "POST",
    body: data,
  })

  if (error) throw error

  await switchTenant(result.id)
}
