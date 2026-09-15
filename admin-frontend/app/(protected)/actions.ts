"use server"

import { refresh } from "next/cache"

import { requireUser } from "@/lib/dal"
import { CreateTenantFormData } from "../(auth)/welcome/client"
import { Tenant } from "@prisma"
import { fetchData } from "@/lib/data/data-fetch"

export async function switchTenant(tenantId: string): Promise<void> {
  // requireUser, not requireTenant: this is the call that gives a brand new
  // account its first active tenant, so demanding one up front would redirect
  // it straight back to /welcome and the switch below would never run.
  await requireUser()

  // The backend verifies membership via isTenantMember, so a 403 here is correct.
  const [error] = await fetchData("/api/auth/tenant/switch", {
    method: "POST",
    body: { tenantId },
  })

  if (error) throw error

  // getSession is a private cache with a 60s stale window. Without this the app
  // keeps reading the pre-switch session and bounces back to /welcome.
  refresh()
}

export async function createTenant(data: CreateTenantFormData): Promise<void> {
  const [error, result] = await fetchData<Tenant>("/api/tenants", {
    method: "POST",
    body: data,
  })

  if (error) throw error

  await switchTenant(result.id)
}
