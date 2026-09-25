import type { Session, SessionSubscription } from "./session-fetch"

/**
 * Where a user stands in onboarding, decided in one place.
 *
 * Pages never re-derive this. They call `resolveUserAccess(session)` (or, more
 * usually, `requireAccess()` in lib/dal.ts, which acts on the answer) so there
 * is exactly one description of what "ready" means and one set of redirects.
 *
 * This is a UI routing decision, not a security boundary — the backend chains
 * `requireAuth -> requireTenant -> requireSubscription -> requirePermission` on
 * every business route regardless of what this returns.
 */
export type AccessState =
  | "AUTH_REQUIRED"
  | "NO_ORGANIZATION"
  | "SELECT_ORGANIZATION"
  | "BILLING_REQUIRED"
  | "BILLING_LOCKED"
  | "SUBSCRIPTION_UNKNOWN"
  | "READY"

export type UserAccess = {
  authenticated: boolean
  activeTenantId: string | null
  memberships: Session["tenants"]
  pendingInvitations: Session["tenantInvites"]
  subscription: SessionSubscription | null
  isOwner: boolean
  accessState: AccessState
}

/** The statuses that let a user into the application. Mirrors
 *  `ACCESS_GRANTING_STATUSES` in the backend's subscriptions.service.ts — the
 *  backend's copy is the enforcing one. */
const ACCESS_GRANTING = ["active", "trialing"] as const

function subscriptionGrantsAccess(
  subscription: SessionSubscription
): boolean {
  if (
    !(ACCESS_GRANTING as readonly string[]).includes(subscription.status)
  ) {
    return false
  }

  // A trial whose end date has passed is not access. Stripe's webhook does
  // move a lapsed trial on, but that event may still be in flight, and a trial
  // started locally has no Stripe object behind it — so it is checked at read
  // time too. Mirrors hasValidSubscription in the backend, which enforces it.
  if (subscription.status === "trialing" && subscription.trialEndsAt) {
    return new Date(subscription.trialEndsAt) > new Date()
  }

  return true
}

export const ANONYMOUS_ACCESS: UserAccess = {
  authenticated: false,
  activeTenantId: null,
  memberships: [],
  pendingInvitations: [],
  subscription: null,
  isOwner: false,
  accessState: "AUTH_REQUIRED",
}

/**
 * Pure over the session, so it is unit-testable and can be called from a page,
 * a layout or a server action without a second round trip — every field it
 * needs is already on `/get-session`.
 *
 * Note the order: the active tenant is settled before billing is looked at. A
 * user with no organization is not "unpaid", they are un-onboarded, and sending
 * them to a paywall for an organization that does not exist would be a dead
 * end.
 */
export function resolveUserAccess(session: Session | null): UserAccess {
  if (!session) return ANONYMOUS_ACCESS

  const base = {
    authenticated: true as const,
    activeTenantId: session.activeTenantId,
    memberships: session.tenants,
    pendingInvitations: session.tenantInvites,
    subscription: session.subscription,
    isOwner: session.isOwner,
  }

  // The backend already drops an activeTenantId the user is no longer a member
  // of, but re-checking here costs nothing and keeps this function honest on
  // its own terms rather than dependent on that.
  const activeIsValid =
    session.activeTenantId !== null &&
    session.tenants.some((tenant) => tenant.id === session.activeTenantId)

  if (!activeIsValid) {
    if (session.tenants.length === 0) {
      return { ...base, activeTenantId: null, accessState: "NO_ORGANIZATION" }
    }

    // One membership needs no choice — the caller activates it and carries on.
    // More than one is a genuine question for the user.
    return {
      ...base,
      activeTenantId: null,
      accessState: "SELECT_ORGANIZATION",
    }
  }

  // A platform superuser sees every tenant, so their active one is usually
  // somebody else's organization and `isOwner` is false — the paywall would
  // send them to the locked page, a dead end, for a bill that is not theirs.
  // The backend's requireSubscription lets them through for the same reason.
  // Note the position: after the tenant is settled, so a superadmin with no
  // organization still goes through onboarding rather than into a tenant-less
  // application.
  if (session.user.isSuperAdmin === true) {
    return { ...base, accessState: "READY" }
  }

  // `null` here is a failed lookup, not an absent subscription: an absent one
  // comes back as `pending`. Treating it as unpaid would paywall a paying
  // tenant because of a transient database error.
  if (!session.subscription) {
    return { ...base, accessState: "SUBSCRIPTION_UNKNOWN" }
  }

  if (subscriptionGrantsAccess(session.subscription)) {
    return { ...base, accessState: "READY" }
  }

  // Same billing state, two different destinations: an owner can fix it, a
  // member can only be told who to ask.
  return {
    ...base,
    accessState: session.isOwner ? "BILLING_REQUIRED" : "BILLING_LOCKED",
  }
}

/** Where each state sends a user who tried to reach a protected page. `READY`
 *  has no destination — it is the page they asked for. */
export const ACCESS_REDIRECTS: Record<
  Exclude<AccessState, "READY">,
  string
> = {
  AUTH_REQUIRED: "/login",
  NO_ORGANIZATION: "/onboarding",
  SELECT_ORGANIZATION: "/organizations/select",
  BILLING_REQUIRED: "/billing",
  BILLING_LOCKED: "/billing/locked",
  SUBSCRIPTION_UNKNOWN: "/billing",
}
