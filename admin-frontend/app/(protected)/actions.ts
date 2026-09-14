"use server"

import { revalidateTag } from "next/cache"

import { tenantTags } from "@/lib/cache-tags"
import { requireTenant } from "@/lib/dal"
import { CreateTenantFormData } from "../(auth)/welcome/client"
import { Tenant } from "@prisma"
import { fetchData } from "@/lib/data/data-fetch"

// Next 16 requires a cache-life profile as revalidateTag's second argument.
// These are explicit, user-triggered mutations, so expire the entry immediately
// rather than serving it stale-while-revalidate for one more render.
const IMMEDIATE = { expire: 0 } as const

export async function switchTenant(tenantId: string): Promise<void> {
  const session = await requireTenant()

  // The backend verifies membership via isTenantMember, so a 403 here is correct.
  const [error] = await fetchData("/api/auth/tenant/switch", {
    method: "POST",
    body: { tenantId },
  })

  // Clear both tenants: the one being left and the one being entered.
  for (const tag of [
    ...tenantTags(session.activeTenantId),
    ...tenantTags(tenantId),
  ]) {
    revalidateTag(tag, IMMEDIATE)
  }
}

export async function createTenant(data: CreateTenantFormData): Promise<void> {
  const [error, result] = await fetchData<Tenant>("/api/tenants", {
    method: "POST",
    body: data,
  })

  if (error) {
    throw error
  }

  await switchTenant(result.id)

  revalidateTag("tenants", IMMEDIATE)
}
