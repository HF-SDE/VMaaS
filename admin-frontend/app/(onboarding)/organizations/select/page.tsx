import { redirect } from "next/navigation"

import { getAccess } from "@/lib/dal"

import { SelectOrganizationClient } from "./client"

export const instant = false

export const metadata = { title: "Choose an organization" }

/**
 * Shown when a user belongs to several organizations and none is active.
 *
 * A single membership never reaches this page — `resolveUserAccess` reports
 * SELECT_ORGANIZATION for it too, but the client activates it without asking,
 * because there is no choice to make.
 */
export default async function SelectOrganizationPage() {
  const { access } = await getAccess()

  if (access.accessState === "AUTH_REQUIRED") redirect("/login")
  if (access.accessState === "NO_ORGANIZATION") redirect("/onboarding")
  // Already inside an organization: nothing to choose.
  if (access.accessState !== "SELECT_ORGANIZATION") redirect("/")

  return (
    <SelectOrganizationClient
      organizations={access.memberships}
      invitations={access.pendingInvitations}
    />
  )
}
