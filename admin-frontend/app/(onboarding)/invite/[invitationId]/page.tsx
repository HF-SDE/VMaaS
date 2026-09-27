import { redirect } from "next/navigation"

import { getSession } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { signInPath } from "@/lib/auth-redirect"

import { InviteClient, type InviteDetail } from "./client"
import { InviteProblem } from "./problem"

export const instant = false

export const metadata = { title: "Invitation" }

/**
 * The page an invitation email links to.
 *
 * Two things make it unlike the rest of the app:
 *   - it is reachable signed out, and sends the visitor to sign in *carrying
 *     the invitation URL*, so they come back here afterwards. It never accepts
 *     an invitation merely because someone signed in;
 *   - it lives in `(onboarding)`, not `(protected)`, because the whole point is
 *     that the visitor is not yet a member of the organization named on it.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ invitationId: string }>
}) {
  const { invitationId } = await params
  const session = await getSession()

  // Signed out — including someone who has no account at all. The sign-in page
  // carries them back here, and its "Sign up" link carries the same target, so
  // a brand new user still lands on the invitation.
  if (!session) {
    redirect(signInPath(`/invite/${invitationId}`))
  }

  const [error, invite] = await fetchData<InviteDetail>(
    `/api/tenants/invites/${invitationId}`
  )

  if (error) {
    return (
      <InviteProblem
        title={
          error.status === 404
            ? "Invitation not found"
            : "Could not load this invitation"
        }
        description={
          error.status === 404
            ? "This invitation does not exist. It may have been withdrawn."
            : "Something went wrong loading this invitation. Please try again in a moment."
        }
      />
    )
  }

  return <InviteClient invite={invite} viewerEmail={session.user.email} />
}
