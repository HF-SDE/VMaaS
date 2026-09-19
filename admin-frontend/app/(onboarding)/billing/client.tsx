"use client"

import Link from "next/link"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CreditCard, Loader2, ShieldAlert } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"
import type { AccessState } from "@/lib/access"
import type { SessionSubscription, SubscriptionStatus } from "@/lib/session-fetch"

import { simulateSubscriptionActivation } from "../actions"
import { formatExpiry } from "../invitation-card"

/** Human wording per status. The paywall has to explain *why* it is showing,
 *  because "past due" and "never started" call for different actions. */
const STATUS_COPY: Record<
  SubscriptionStatus,
  { label: string; description: string; tone: "ok" | "warn" }
> = {
  active: {
    label: "Active",
    description: "Your subscription is active.",
    tone: "ok",
  },
  trialing: {
    label: "Trial",
    description: "You are on a trial.",
    tone: "ok",
  },
  pending: {
    label: "Not started",
    description:
      "This organization does not have a subscription yet. Start one to unlock the application.",
    tone: "warn",
  },
  past_due: {
    label: "Past due",
    description:
      "The last payment failed. Update your payment details to restore access.",
    tone: "warn",
  },
  canceled: {
    label: "Canceled",
    description:
      "This subscription was canceled. Start a new one to restore access.",
    tone: "warn",
  },
  incomplete: {
    label: "Incomplete",
    description: "Checkout was never completed. Start again to unlock access.",
    tone: "warn",
  },
  unpaid: {
    label: "Unpaid",
    description:
      "There are unpaid invoices on this organization. Settle them to restore access.",
    tone: "warn",
  },
}

export function BillingClient({
  organizationName,
  subscription,
  accessState,
  isOwner,
  allowSimulation,
}: {
  organizationName: string
  subscription: SessionSubscription | null
  accessState: AccessState
  isOwner: boolean
  allowSimulation: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const status = subscription?.status
  const copy = status ? STATUS_COPY[status] : null
  const hasAccess = accessState === "READY"

  function activate() {
    startTransition(async () => {
      const error = await simulateSubscriptionActivation()
      if (error) {
        toast.error(
          error.status === 403
            ? "Only an owner can change billing for this organization."
            : "Could not activate the subscription. Please try again."
        )
        return
      }
      toast.success("Subscription activated.")
      // The access resolver now answers READY, so the dashboard lets them in.
      router.push("/")
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-5" />
          Billing
        </CardTitle>
        <CardDescription>{organizationName}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* A failed lookup is not a billing state. Saying "not subscribed"
            here would be a lie that sends a paying customer to checkout. */}
        {accessState === "SUBSCRIPTION_UNKNOWN" || !copy ? (
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
            <ShieldAlert className="mt-0.5 size-5 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                We could not check this organization&apos;s subscription
              </p>
              <p className="text-sm text-muted-foreground">
                This is usually temporary. Please try again in a moment.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={copy.tone === "ok" ? "default" : "destructive"}>
                {copy.label}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">{copy.description}</p>

            {subscription?.trialEndsAt && status === "trialing" && (
              <Row
                label="Trial ends"
                value={formatExpiry(subscription.trialEndsAt)}
              />
            )}
            {subscription?.currentPeriodEnd && (
              <Row
                label="Renews"
                value={formatExpiry(subscription.currentPeriodEnd)}
              />
            )}
          </>
        )}
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3">
        {accessState === "SUBSCRIPTION_UNKNOWN" && (
          <Button variant="outline" onClick={() => router.refresh()}>
            Try again
          </Button>
        )}

        {hasAccess && (
          <Button render={<Link href="/" />}>Go to dashboard</Button>
        )}

        {/* Stripe is not wired up yet. The button is present so the flow is
            complete end to end, and says plainly that it does nothing. */}
        {isOwner && !hasAccess && (
          <Button disabled title="Stripe is not configured yet">
            Continue to checkout
          </Button>
        )}

        {isOwner && allowSimulation && (
          <>
            <Separator />
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="text-xs font-medium">Development only</p>
              <p className="text-xs text-muted-foreground">
                Stands in for the Stripe webhook that will eventually activate
                this subscription. Not available in production.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={activate}
                disabled={pending}
              >
                {pending && <Loader2 className="animate-spin" />}
                Simulate successful payment
              </Button>
            </div>
          </>
        )}
      </CardFooter>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}
