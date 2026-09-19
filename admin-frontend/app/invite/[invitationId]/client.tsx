"use client"

import Link from "next/link"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Mail } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { signInPath } from "@/lib/auth-redirect"
import {
  acceptInviteAndEnter,
  respondToInvite,
} from "@/app/(onboarding)/actions"
import { formatExpiry } from "@/app/(onboarding)/invitation-card"

import { InviteProblem } from "./problem"

export type InviteDetail = {
  id: string
  email: string
  tenantId: string
  tenantName: string
  roleName: string
  invitedBy?: string
  status: "pending" | "accepted" | "expired" | "revoked" | "rejected"
  expiresAt: string
  matchesViewer: boolean
  alreadyMember: boolean
}

/**
 * The invitation, and the four ways it can already be settled.
 *
 * Each case is checked in the order a user would hit it, and every one of them
 * renders an explanation rather than a disabled button — "why can't I click
 * this" is the failure mode worth designing out. The backend re-checks all of
 * them regardless of what this renders.
 */
export function InviteClient({
  invite,
  viewerEmail,
}: {
  invite: InviteDetail
  viewerEmail: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const expired = new Date(invite.expiresAt) < new Date()

  // Signed in as somebody else. Offer to sign in as the invited address rather
  // than leaving them to work out what to do — and come back here afterwards.
  if (!invite.matchesViewer) {
    return (
      <InviteProblem
        title="This invitation is for a different account"
        description={`It was sent to ${invite.email}, but you are signed in as ${viewerEmail}.`}
        action={
          <Button render={<Link href={signInPath(`/invite/${invite.id}`)} />}>
            Sign in as {invite.email}
          </Button>
        }
      />
    )
  }

  if (invite.alreadyMember) {
    return (
      <InviteProblem
        title={`You're already in ${invite.tenantName}`}
        description="This invitation has nothing left to do — you are already a member of this organization."
      />
    )
  }

  if (invite.status === "accepted") {
    return (
      <InviteProblem
        title="Already accepted"
        description="This invitation has already been accepted."
      />
    )
  }

  if (invite.status !== "pending") {
    return (
      <InviteProblem
        title="Invitation no longer valid"
        description={
          invite.status === "revoked"
            ? "This invitation was withdrawn by the organization."
            : "This invitation is no longer valid."
        }
      />
    )
  }

  if (expired) {
    return (
      <InviteProblem
        title="Invitation expired"
        description={`This invitation expired on ${formatExpiry(invite.expiresAt)}. Ask an owner of ${invite.tenantName} to send a new one.`}
      />
    )
  }

  function accept() {
    startTransition(async () => {
      // Redirects on success, so anything after this ran only on failure.
      const error = await acceptInviteAndEnter(invite.id)
      if (error) {
        toast.error(responseErrorMessage(error.status))
        router.refresh()
      }
    })
  }

  function decline() {
    startTransition(async () => {
      const [error] = await respondToInvite(invite.id, "rejected")
      if (error) {
        toast.error(responseErrorMessage(error.status))
        return
      }
      toast.success(`Declined the invitation to ${invite.tenantName}.`)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
          <Mail className="size-5 text-muted-foreground" />
        </div>
        <CardTitle>You&apos;ve been invited to {invite.tenantName}</CardTitle>
        <CardDescription>
          {invite.invitedBy
            ? `${invite.invitedBy} invited you to join this organization.`
            : "You have been invited to join this organization."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        <Row label="Organization" value={invite.tenantName} />
        <Row
          label="Role"
          value={<Badge variant="secondary" className="capitalize">{invite.roleName}</Badge>}
        />
        <Row label="Invited address" value={invite.email} />
        <Row label="Expires" value={formatExpiry(invite.expiresAt)} />
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-2">
        <Button onClick={accept} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Accept invitation
        </Button>
        <Button variant="ghost" onClick={decline} disabled={pending}>
          Decline
        </Button>
      </CardFooter>
    </Card>
  )
}

/** The invitation may have been settled in another tab, or revoked, between
 *  this page rendering and the button being pressed. */
function responseErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session expired. Please sign in again."
    case 403:
      return "That invitation was sent to a different email address."
    case 404:
      return "That invitation no longer exists."
    case 409:
      return "That invitation has already been used or has expired."
    default:
      return "Something went wrong. Please try again."
  }
}

function Row({
  label,
  value,
}: {
  label: string
  value: React.ReactNode | string | null
}) {
  if (!value) return null

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
