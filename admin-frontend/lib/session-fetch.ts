import type { PermissionKey } from "../../shared/types/permissions"
import { config } from "./config"

export type Session = {
  user: { id: string; name: string; email: string }
  activeTenantId: string | null
  tenants: { id: string; name: string }[]
  permissions: PermissionKey[]
}

type SessionResponse = {
  user: { id: string; name: string; email: string }
  session: { activeTenantId?: string | null }
  tenants?: { id: string; name: string }[]
  permissions?: PermissionKey[]
} | null

/** Pure over its input so it is unit-testable: the caller supplies the cookie header. */
export async function fetchSession(
  cookieHeader: string
): Promise<Session | null> {
  if (!cookieHeader) return null

  const response = await fetch(`${config.BACKEND_URL}/api/auth/get-session`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  })

  if (response.status === 401) return null

  // An API outage must reach an error boundary, not masquerade as "signed out".
  if (!response.ok) throw new Error(`Session lookup failed: ${response.status}`)

  const body = (await response.json()) as SessionResponse
  if (!body?.user) return null

  return {
    user: body.user,
    activeTenantId: body.session?.activeTenantId ?? null,
    tenants: body.tenants ?? [],
    permissions: body.permissions ?? [],
  }
}
