"use server"

import { revalidateTag } from "next/cache"
import { PERMISSIONS } from "../../../shared/types/permissions"

import { backendFetch } from "@/lib/backend"
import { tenantTags } from "@/lib/cache-tags"
import { requirePermission, requireTenant } from "@/lib/dal"

// Next 16 requires a cache-life profile as revalidateTag's second argument.
// These are explicit, user-triggered mutations, so expire the entry immediately
// rather than serving it stale-while-revalidate for one more render.
const IMMEDIATE = { expire: 0 } as const

export async function switchTenant(tenantId: string): Promise<void> {
  const session = await requireTenant()

  // The backend verifies membership via isTenantMember, so a 403 here is correct.
  await backendFetch("/api/auth/tenant/switch", {
    method: "POST",
    json: { tenantId },
  })

  // Clear both tenants: the one being left and the one being entered.
  for (const tag of [
    ...tenantTags(session.activeTenantId),
    ...tenantTags(tenantId),
  ]) {
    revalidateTag(tag, IMMEDIATE)
  }
}

export async function createMachine(formData: FormData): Promise<void> {
  const { activeTenantId } = await requirePermission(PERMISSIONS.MACHINE_WRITE)

  await backendFetch("/api/machines", {
    method: "POST",
    tenantId: activeTenantId,
    json: {
      name: formData.get("name"),
      location: formData.get("location") || undefined,
    },
  })

  revalidateTag(`machines:${activeTenantId}`, IMMEDIATE)
}
