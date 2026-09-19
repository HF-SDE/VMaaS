import "server-only"

import { cacheLife, cacheTag } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { PermissionKey } from "@vmaas/shared/types/permissions"

import { ACCESS_REDIRECTS, resolveUserAccess } from "./access"
import { forbiddenPath } from "./forbidden"
import { hasPermission } from "./permissions"
import { fetchSession, type Session } from "./session-fetch"
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

export async function requireUser(): Promise<Session> {
  const session = await getSession()
  if (!session) redirect("/login")
  return session
}

/**
 * The gate for every protected page: signed in, in an organization, and that
 * organization paid up.
 *
 * All three are one decision, taken by `resolveUserAccess`, so a page cannot
 * accidentally check two of the three. `requirePermission` chains through here,
 * which is why the existing pages need no change to be behind the paywall.
 *
 * The backend enforces the same three independently — this only decides where
 * to send the browser.
 */
export async function requireAccess(): Promise<
  Session & { activeTenantId: string }
> {
  const session = await getSession()
  const access = resolveUserAccess(session)

  if (access.accessState !== "READY") {
    redirect(ACCESS_REDIRECTS[access.accessState])
  }

  return session as Session & { activeTenantId: string }
}

/** @deprecated Prefer `requireAccess()`, which also enforces billing. Kept so
 *  callers that genuinely only need a tenant — the billing pages themselves —
 *  do not have to fight the paywall they exist to resolve. */
export async function requireTenant(): Promise<
  Session & { activeTenantId: string }
> {
  return requireAccess()
}

/**
 * Sends a denied user to /forbidden, the same place <RoleGate> sends them, so
 * a page-level and a component-level denial look alike. `reason` is plain
 * English copy for that page; omit it for the generic wording.
 *
 * Use hasPermission() instead for conditional UI, where hiding one control
 * should not take the whole page away.
 */
export async function requirePermission(
  key: PermissionKey,
  reason?: string
): Promise<Session & { activeTenantId: string }> {
  const session = await requireAccess()
  if (!hasPermission(session, key)) redirect(forbiddenPath(reason))
  return session
}
