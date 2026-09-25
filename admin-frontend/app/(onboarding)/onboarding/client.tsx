"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { createTenantSchema } from "@vmaas/shared/schemas"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ItemActions } from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import type { Session } from "@/lib/session-fetch"
import type { CreateTenantFormData } from "@/lib/tenant-form"
import { createTenant } from "@/app/(protected)/actions"

import { acceptInviteAndEnter, respondToInvite } from "../actions"
import { InvitationCard } from "../invitation-card"

/**
 * First-run screen for a user who belongs to no organization.
 *
 * Shows every pending invitation alongside the create form rather than
 * choosing for them — someone invited to two organizations who also wants
 * their own should not have to back out of a decision the page made.
 */
export function OnboardingClient({
  invitations,
  hasOrganizations = false,
}: {
  invitations: Session["tenantInvites"]
  /** True when the user already belongs to organizations but has none active.
   *  They reached this page on purpose, so it offers a way back to the picker. */
  hasOrganizations?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          {invitations.length > 0
            ? "Join an organization you've been invited to, or create your own."
            : "Create an organization to start managing your machines."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {invitations.length > 0 && (
          <>
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <PendingInvitation
                  key={invitation.id}
                  invitation={invitation}
                />
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">OR</span>
              <Separator className="flex-1" />
            </div>
          </>
        )}

        <CreateOrganizationForm />

        {hasOrganizations && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            render={<Link href="/organizations/select" />}
          >
            Back to your organizations
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function PendingInvitation({
  invitation,
}: {
  invitation: Session["tenantInvites"][number]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function join() {
    startTransition(async () => {
      // Resolves by redirecting on success, so nothing after this runs unless
      // it failed.
      const error = await acceptInviteAndEnter(invitation.id)
      if (error) toast.error(inviteErrorMessage(error.status))
    })
  }

  function decline() {
    startTransition(async () => {
      const [error] = await respondToInvite(invitation.id, "rejected")
      if (error) {
        toast.error(inviteErrorMessage(error.status))
        return
      }
      toast.success(`Declined the invitation to ${invitation.tenantName}.`)
      router.refresh()
    })
  }

  return (
    <InvitationCard
      organizationName={invitation.tenantName}
      roleName={invitation.roleName}
      invitedBy={invitation.invitedBy}
      expiresAt={invitation.expiresAt}
      action={
        <ItemActions className="flex-col gap-2 sm:flex-row">
          <Button size="sm" onClick={join} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Join {invitation.tenantName}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={decline}
            disabled={pending}
          >
            Decline
          </Button>
        </ItemActions>
      }
    />
  )
}

/** Wording per status, so a stale invitation reads as an explanation rather
 *  than as a generic failure. */
export function inviteErrorMessage(status: number): string {
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

function CreateOrganizationForm() {
  const [submitting, setSubmitting] = useState(false)
  const form = useForm<CreateTenantFormData>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { name: "", description: "" },
  })

  async function onSubmit(data: CreateTenantFormData) {
    setSubmitting(true)
    try {
      // Creates the organization, makes the user its owner and activates it.
      // The new organization has no subscription, so the access resolver sends
      // them to /billing next.
      await createTenant(data)
    } catch {
      toast.error("Could not create the organization. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Controller
        name="name"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="organization-name">
              Organization name
            </FieldLabel>
            <Input
              {...field}
              id="organization-name"
              placeholder="Acme"
              autoComplete="organization"
              aria-invalid={fieldState.invalid}
            />
            {fieldState.error && (
              <FieldError>{fieldState.error.message}</FieldError>
            )}
          </Field>
        )}
      />

      <Controller
        name="description"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="organization-description">
              Description <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              {...field}
              value={field.value ?? ""}
              id="organization-description"
              placeholder="What this organization does"
              autoComplete="off"
              aria-invalid={fieldState.invalid}
            />
          </Field>
        )}
      />

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="animate-spin" />}
        Create organization
      </Button>
    </form>
  )
}
