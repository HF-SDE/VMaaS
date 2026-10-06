import "server-only"

import { cacheLife, cacheTag } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { PermissionKey } from "@vmaas/shared/types/permissions"

import { ACCESS_REDIRECTS, resolveUserAccess } from "./access"
import { forbiddenPath } from "./forbidden"
import { hasPermission } from "./permissions"
import { fetchSession, type Session } from "./session"
import { getAuthCookie } from "./data/fetch-helpers"

export type { Session }

/** Reads the session cookie, so it cannot live in a plain `use cache` scope.
 *  `use cache: private` lets it read cookies while staying out of the shared,
 *  cross-request server cache. `stale` of at least 30s keeps it prefetchable. */
export async function getSession(redirectOnNull: true): Promise<Session>
export async function getSession(
  redirectOnNull?: false
): Promise<Session | null>
export async function getSession(
  redirectOnNull = false
): Promise<Session | null> {
  "use cache: private"
  cacheLife({ stale: 60 })
  cacheTag("tenants")

  const store = await cookies()

  const session = await fetchSession(getAuthCookie(store.getAll()))

  if (!session && redirectOnNull) redirect("/login")

  return session
}

export async function getFreshSession(): Promise<Session | null> {
  const store = await cookies()

  return fetchSession(getAuthCookie(store.getAll()))
}

export async function getAccess() {
  "use cache: private"
  cacheLife({ stale: 60 })
  cacheTag("tenants")

  const session = await getSession()

  return { session, access: resolveUserAccess(session) }
}

export async function requireUser(): Promise<Session> {
  const session = await getSession()
  if (!session) redirect("/login")
  return session
}

export async function requireAccess(): Promise<
  Session & { activeTenantId: string }
> {
  const { session, access } = await getAccess()

  if (access.accessState !== "READY") {
    redirect(ACCESS_REDIRECTS[access.accessState])
  }

  return session as Session & { activeTenantId: string }
}

export async function requirePermission(
  key: PermissionKey,
  reason?: string
): Promise<Session & { activeTenantId: string }> {
  const session = await requireAccess()
  if (!hasPermission(session, key)) redirect(forbiddenPath(reason))
  return session
}
