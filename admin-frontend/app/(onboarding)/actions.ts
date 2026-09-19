"use server"

import { redirect } from "next/navigation"
import { updateTag } from "next/cache"
import { err, ok, type HttpError, type Result } from "@vmaas/shared/lib/error-handling"

import { requireUser } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
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
export async function acceptInviteAndEnter(inviteId: string): Promise<HttpError | null> {
  const [error, result] = await respondToInvite(inviteId, "accepted")
  if (error) return error

  const [switchError] = await switchTenant(result.tenantId)
  if (switchError) return switchError

  // The new organization has no subscription yet, so this lands on /billing or
  // /billing/locked rather than the dashboard — which is the intended flow.
  redirect("/")
}

/**
 * DEVELOPMENT ONLY — stands in for the Stripe webhook.
 *
 * Calls the backend's simulate endpoint, which is itself mounted only outside
 * production and re-checks ownership. Nothing about "the payment succeeded"
 * is decided here; the backend's `markSubscriptionActive` is the one authority.
 */
export async function simulateSubscriptionActivation(): Promise<HttpError | null> {
  await requireUser()

  const [error] = await fetchData("/api/subscriptions/dev/simulate", {
    method: "POST",
    body: { type: "subscription.activated" },
  })

  if (error) return error

  // Without this the access resolver keeps reading the cached "pending"
  // subscription and bounces the user back to the paywall they just cleared.
  updateTag("tenants")

  return null
}
