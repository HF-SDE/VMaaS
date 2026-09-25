import { redirect } from "next/navigation"

import { getAccess } from "@/lib/dal"

import { BillingClient, type CheckoutOutcome } from "./client"

export const instant = false

export const metadata = { title: "Billing" }

/**
 * The owner's paywall, and the billing status page once an organization is
 * paid up.
 *
 * Reachable in every state that has an active organization, so an owner can
 * come here to look at billing rather than only being sent here when it is
 * broken.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const { access } = await getAccess()

  if (access.accessState === "AUTH_REQUIRED") redirect("/login")
  if (access.accessState === "NO_ORGANIZATION") redirect("/onboarding")
  if (access.accessState === "SELECT_ORGANIZATION") {
    redirect("/organizations/select")
  }

  // A member cannot act on billing at all — they get the locked page, which
  // explains who can. Owners stay here even when everything is in order.
  if (access.accessState === "BILLING_LOCKED") redirect("/billing/locked")

  const organization = access.memberships.find(
    (tenant) => tenant.id === access.activeTenantId
  )

  // Whatever Stripe sent the browser back with. It only chooses wording — the
  // subscription itself is whatever the session says, which comes from the
  // webhook. An attacker appending ?checkout=success gets a sentence, not
  // access.
  const { checkout } = await searchParams
  const checkoutOutcome: CheckoutOutcome =
    checkout === "success" || checkout === "canceled" ? checkout : null

  return (
    <BillingClient
      organizationName={organization?.name ?? "your organization"}
      subscription={access.subscription}
      accessState={access.accessState}
      isOwner={access.isOwner}
      checkoutOutcome={checkoutOutcome}
    />
  )
}
