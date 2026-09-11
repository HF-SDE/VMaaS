import "server-only"

import { cacheLife } from "next/cache"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { PermissionKey } from "../../shared/types/permissions"

import { authCookieHeader } from "./backend"
import { hasPermission } from "./permissions"
import { fetchSession, type Session } from "./session-fetch"

export type { Session }

/** Reads the session cookie, so it cannot live in a plain `use cache` scope.
 *  `use cache: private` lets it read cookies while staying out of the shared,
 *  cross-request server cache. `stale` of at least 30s keeps it prefetchable. */
export async function getSession(): Promise<Session | null> {
  "use cache: private"
  cacheLife({ stale: 60 })

  const store = await cookies()

  return fetchSession(authCookieHeader(store.getAll()))
}

export async function requireUser(): Promise<Session> {
  const session = await getSession()
  if (!session) redirect("/login")
  return session
}

export async function requireTenant(): Promise<
  Session & { activeTenantId: string }
> {
  const session = await requireUser()
  if (!session.activeTenantId) redirect("/welcome")
  return session as Session & { activeTenantId: string }
}

/** Uses notFound() rather than forbidden(), which needs experimental
 *  `authInterrupts`. Use hasPermission() for conditional UI instead. */
export async function requirePermission(
  key: PermissionKey
): Promise<Session & { activeTenantId: string }> {
  const session = await requireTenant()
  if (!hasPermission(session, key)) notFound()
  return session
}
