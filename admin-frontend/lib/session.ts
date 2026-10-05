import type { PermissionKey } from "@vmaas/shared/types/permissions"
import type { SubscriptionPlan } from "@vmaas/shared/schemas"
import type { SubscriptionStatus } from "@vmaas/shared/types"
import { config } from "./config"

export type Session = {
  user: { id: string; name: string; email: string; isSuperAdmin?: boolean }
  activeTenantId: string | null
  tenants: { id: string; name: string }[]
  tenantInvites: TenantInvite[]
  permissions: PermissionKey[]
  /** The active tenant's billing state. `null` means either "no active tenant"
   *  or "the lookup failed" — never "not subscribed", which is the `pending`
   *  status. lib/access.ts is what tells those apart. */
  subscription: SessionSubscription | null
  /** Whether the user owns the *active* tenant. Billing is the owner's alone,
   *  so this is what decides paywall versus locked page. */
  isOwner: boolean
}

export type SessionSubscription = {
  status: SubscriptionStatus
  /** Which plan is being billed. `null` before checkout, and for a Stripe price
   *  the backend does not recognise — never a default, which would name a plan
   *  nobody chose. */
  plan?: SubscriptionPlan | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  /** Set when the owner has canceled. Stripe keeps the subscription `active`
   *  until `currentPeriodEnd`, so this is the only thing that distinguishes
   *  "renews then" from "ends then". */
  cancelAtPeriodEnd?: boolean
}

type SessionResponse = {
  user: { id: string; name: string; email: string; isSuperAdmin?: boolean }
  session: { activeTenantId?: string | null }
  tenants?: { id: string; name: string }[]
  tenantInvites?: TenantInvite[]
  permissions?: PermissionKey[]
  subscription?: SessionSubscription | null
  isOwner?: boolean
} | null

export type TenantInvite = {
  id: string
  tenantId: string
  tenantName: string
  token: string
  roleName?: string
  invitedBy?: string
  expiresAt: string
}

// If a session lookup fails transiently, retry once after this delay.
const RETRY_DELAY_MS = 250
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function isTransient(status: number): boolean {
  return status === 429 || status >= 500
}

function getSessionResponse(cookieHeader: string): Promise<Response> {
  return fetch(`${config.BACKEND_INTERNAL_URL}/api/auth/get-session`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  })
}

async function requestSession(cookieHeader: string): Promise<Response> {
  try {
    const response = await getSessionResponse(cookieHeader)
    if (!isTransient(response.status)) return response
  } catch {
    // Swallow the error: it will be retried after the delay.
  }

  await sleep(RETRY_DELAY_MS)

  return getSessionResponse(cookieHeader)
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
    subscription: body.subscription ?? null,
    isOwner: body.isOwner ?? false,
  }
}
