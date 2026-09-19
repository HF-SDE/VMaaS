import { redirect } from "next/navigation"

import { getSession } from "@/lib/dal"
import { resolveUserAccess } from "@/lib/access"
import { config } from "@/lib/config"

import { BillingClient } from "./client"

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
export default async function BillingPage() {
  const session = await getSession()
  const access = resolveUserAccess(session)

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

  return (
    <BillingClient
      organizationName={organization?.name ?? "your organization"}
      subscription={access.subscription}
      accessState={access.accessState}
      isOwner={access.isOwner}
      // The simulate button is a development affordance and must not render in
      // production — the endpoint behind it is not mounted there either.
      allowSimulation={config.NODE_ENV !== "production"}
    />
  )
}
