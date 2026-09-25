import { redirect } from "next/navigation"

import { getAccess } from "@/lib/dal"

import { OnboardingClient } from "./client"

/** Reads the session, so it cannot be prerendered. */
export const instant = false

export const metadata = { title: "Get started" }

/**
 * The landing place for a user who belongs to no organization.
 *
 * Offers whatever pending invitations they have alongside creating their own,
 * because "you were invited" and "start your own" are equally valid first
 * steps and a user who has both should not have to guess.
 */
export default async function OnboardingPage() {
  const { access } = await getAccess()

  if (access.accessState === "AUTH_REQUIRED") redirect("/login")

  // Reachable whenever no organization is active — which covers both "you have
  // none" and "you have several and have not picked one", because a user in the
  // second case may still want to accept an invitation or start their own. Once
  // an organization *is* active, this page has nothing to offer and billing or
  // the dashboard is the right destination.
  const isOnboarding =
    access.accessState === "NO_ORGANIZATION" ||
    access.accessState === "SELECT_ORGANIZATION"

  if (!isOnboarding) redirect("/")

  return (
    <OnboardingClient
      invitations={access.pendingInvitations}
      hasOrganizations={access.memberships.length > 0}
    />
  )
}
