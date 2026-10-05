"use client"

import Link from "next/link"
import { useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Building2, ChevronRight, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Session } from "@/lib/session"
import { switchTenant } from "@/app/(protected)/actions"

/**
 * Organization picker.
 *
 * A user with exactly one membership is switched into it automatically: the
 * access resolver cannot activate anything itself (it is pure), so the one-
 * membership case lands here and is resolved without ever being rendered.
 */
export function SelectOrganizationClient({
  organizations,
  invitations,
}: {
  organizations: Session["tenants"]
  invitations: Session["tenantInvites"]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  /** Guards the auto-switch below against React's double-invocation in
   *  development, which would otherwise fire two switch requests. */
  const autoSwitched = useRef(false)

  function choose(tenantId: string) {
    startTransition(async () => {
      const [error] = await switchTenant(tenantId)
      if (error) {
        toast.error(
          error.status === 403
            ? "You are no longer a member of that organization."
            : "Could not open that organization. Please try again."
        )
        router.refresh()
        return
      }
      router.push("/")
    })
  }

  const only = organizations.length === 1 ? organizations[0] : undefined

  useEffect(() => {
    if (!only || autoSwitched.current) return
    autoSwitched.current = true
    choose(only.id)
    // `choose` is stable enough for this one-shot effect; re-running on every
    // render would defeat the ref guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only])

  if (only) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="animate-spin" />
          Opening {only.name}…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose an organization</CardTitle>
        <CardDescription>
          You belong to {organizations.length} organizations. Pick the one you
          want to work in — you can switch at any time.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* A plain <button> rather than <Item asChild>: Item renders a <div>,
            and a div inside a button is invalid HTML. The row carries Item's
            styling itself so it still matches the rest of the app. */}
        {organizations.map((organization) => (
          <button
            key={organization.id}
            type="button"
            onClick={() => choose(organization.id)}
            disabled={pending}
            className="flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border">
              <Building2 className="size-4" />
            </span>
            <span className="flex-1 text-sm font-medium">
              {organization.name}
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        ))}
      </CardContent>

      {invitations.length > 0 && (
        <CardFooter className="flex-col items-start gap-2">
          <CardDescription>
            You also have {invitations.length} pending invitation
            {invitations.length === 1 ? "" : "s"}.
          </CardDescription>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/onboarding" />}
          >
            View invitations
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
