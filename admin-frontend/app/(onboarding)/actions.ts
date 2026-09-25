"use server"

import { redirect } from "next/navigation"
import { updateTag } from "next/cache"
import {
  err,
  ok,
  type HttpError,
  type Result,
} from "@vmaas/shared/lib/error-handling"
import type { SubscriptionPlan } from "@vmaas/shared/schemas"

import { getFreshSession, requireUser } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { resolveUserAccess, type AccessState } from "@/lib/access"
import { switchTenant } from "@/app/(protected)/actions"

/**
 * Onboarding actions.
 *
 * All of them take the acting user from the session — never from an argument —
 * and every one of them is re-authorized by the backend. `updateTag("tenants")`
 * after a write is what stops `getSession`'s 60s private cache from serving a
 * stale membership or billing state straight back into the access resolver.
 */

export type InviteResponse = "accepted" | "rejected"

/**
 * Accept or decline an invitation.
 *
 * The invitation id is the only thing taken from the caller, and it is not a
 * capability: the backend re-checks that the invited address is the signed-in
 * user's before it creates any membership.
 */
export async function respondToInvite(
  inviteId: string,
  status: InviteResponse
): Promise<Result<HttpError, { tenantId: string }>> {
  await requireUser()

  const [error, data] = await fetchData<{ tenantId: string }>(
    `/api/tenants/invites/${inviteId}/respond`,
    { method: "POST", body: { status } }
  )

  if (error) return err(error)

  updateTag("tenants")

  return ok(data)
}

/**
 * Accept an invitation and go straight into the organization.
 *
 * Joining does not make an organization active, so without the switch the user
 * would land back on onboarding having apparently done nothing.
 */
export async function acceptInviteAndEnter(
  inviteId: string
): Promise<HttpError | null> {
  const [error, result] = await respondToInvite(inviteId, "accepted")
  if (error) return error

  const [switchError] = await switchTenant(result.tenantId)
  if (switchError) return switchError

  // The new organization has no subscription yet, so this lands on /billing or
  // /billing/locked rather than the dashboard — which is the intended flow.
  redirect("/")
}

/**
 * Opens Stripe Checkout for the active organization and hands back the URL.
 *
 * The plan name is the only thing sent — the price it maps to is server-side
 * configuration — and the organization is never named at all: the backend takes
 * it from the session and re-checks that this user owns it.
 *
 * No cache is invalidated here, and deliberately: paying has not happened yet.
 * The subscription becomes active when Stripe's webhook says so, which is why
 * the success page refreshes rather than asserting anything itself.
 */
export async function startCheckout(
  plan: SubscriptionPlan
): Promise<Result<HttpError, { url: string }>> {
  await requireUser()

  const [error, data] = await fetchData<{ url: string }>(
    "/api/subscriptions/checkout",
    { method: "POST", body: { plan } }
  )

  if (error) return err(error)

  return ok(data)
}

/**
 * Opens the Stripe Customer Portal for the active organization and hands back
 * the URL — where the card the subscription is billed to gets changed.
 *
 * The organization is not named here either: the backend takes it from the
 * session and re-checks ownership. No cache is invalidated, for the same reason
 * as `startCheckout` — nothing has changed yet, and whatever the user does on
 * Stripe's page comes back as a webhook.
 */
export async function openBillingPortal(): Promise<
  Result<HttpError, { url: string }>
> {
  await requireUser()

  const [error, data] = await fetchData<{ url: string }>(
    "/api/subscriptions/portal",
    { method: "POST" }
  )

  if (error) return err(error)

  return ok(data)
}

/**
 * Where the user stands right now, read past the session cache.
 *
 * Coming back from Stripe is a plain navigation, so no action has run and
 * nothing has invalidated `getSession`'s 60s private cache — the page would
 * render the session as it was *before* checkout even once the webhook has
 * landed. The billing page polls this until it reports `READY`.
 *
 * Reports rather than redirects: this is called on a timer, and the caller
 * needs to be able to stop polling on a state it cannot act on.
 */
export async function refreshAccessState(): Promise<AccessState> {
  const session = await getFreshSession()
  const { accessState } = resolveUserAccess(session)

  // Only once there is something new to show. Invalidating on every poll would
  // make Next re-render the route every few seconds — and re-fetch the session
  // a second time to do it — to arrive at the same page the user is looking at.
  // On `READY` it is what makes the caller's `router.refresh()` render the
  // subscription as active rather than serving the stale entry again.
  if (accessState === "READY") updateTag("tenants")

  return accessState
}

/**
 * Cancels the active organization's subscription at the end of the paid period.
 *
 * Access is not withdrawn here — the organization keeps it until
 * `currentPeriodEnd`, and the webhook is what ends it when that date arrives.
 * The tag update is still needed so the page stops saying "renews".
 */
export async function cancelSubscription(): Promise<HttpError | null> {
  await requireUser()

  const [error] = await fetchData("/api/subscriptions/cancel", {
    method: "POST",
  })

  if (error) return error

  updateTag("tenants")

  return null
}
