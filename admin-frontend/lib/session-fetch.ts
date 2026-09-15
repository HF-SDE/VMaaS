import type { PermissionKey } from "../../shared/types/permissions"
import { config } from "./config"

export type Session = {
  user: { id: string; name: string; email: string }
  activeTenantId: string | null
  tenants: { id: string; name: string }[]
  tenantInvites: TenantInvite[]
  permissions: PermissionKey[]
}

type SessionResponse = {
  user: { id: string; name: string; email: string }
  session: { activeTenantId?: string | null }
  tenants?: { id: string; name: string }[]
  tenantInvites?: TenantInvite[]
  permissions?: PermissionKey[]
} | null

type TenantInvite = {
  tenantId: string
  tenantName: string
  token: string
  roleName?: string
  expiresAt: Date
}

/** Long enough for a restarting backend or a just-rolled rate-limit window to
 *  come back, short enough that a blocked server render still feels immediate. */
const RETRY_DELAY_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A 429 or a 5xx says "not right now", not "not ever" — the same request may
 * well succeed a moment later. Every other 4xx is a statement about the request
 * itself and would fail identically, so retrying one only doubles the load.
 */
function isTransient(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * One attempt, then one retry after a short backoff. Deliberately not more:
 * this blocks a server render, so a long outage has to reach the error boundary
 * quickly rather than hold the response open. `Retry-After` is ignored for the
 * same reason — the backend's rate-limit window is minutes long.
 */
async function requestSession(cookieHeader: string): Promise<Response> {
  const attempt = () =>
    fetch(`${config.BACKEND_INTERNAL_URL}/api/auth/get-session`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    })

  try {
    const response = await attempt()
    if (!isTransient(response.status)) return response
  } catch {
    // A refused connection or a torn socket is as transient as a 429, and this
    // catch wraps a bare fetch() — it cannot swallow a Next control-flow throw.
  }

  await sleep(RETRY_DELAY_MS)

  return attempt()
}

/** Pure over its input so it is unit-testable: the caller supplies the cookie header. */
export async function fetchSession(
  cookieHeader: string
): Promise<Session | null> {
  if (!cookieHeader) return null

  const response = await requestSession(cookieHeader)

  if (response.status === 401) return null

  // An API outage must reach an error boundary, not masquerade as "signed out".
  if (!response.ok) throw new Error(`Session lookup failed: ${response.status}`)

  const body = (await response.json()) as SessionResponse
  if (!body?.user) return null

  return {
    user: body.user,
    activeTenantId: body.session?.activeTenantId ?? null,
    tenants: body.tenants ?? [],
    tenantInvites: body.tenantInvites ?? [],
    permissions: body.permissions ?? [],
  }
}
