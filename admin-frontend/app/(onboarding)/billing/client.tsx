"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
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
import type { SessionSubscription } from "@/lib/session"
import type { SubscriptionPlan } from "@vmaas/shared/schemas"
import type { SubscriptionStatus } from "@vmaas/shared/types"

import {
  cancelSubscription,
  refreshAccessState,
  startCheckout,
} from "../actions"
import { formatExpiry } from "../invitation-card"
import { NotificationBadge } from "@/components/notification-badge"
import { cn } from "@/lib/utils"

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
      "This organization does not have a subscription yet. Choose a plan to unlock the application.",
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
      "This subscription was canceled. Choose a plan to restore access.",
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

/** The two plans the API sells. The price is deliberately not repeated here —
 *  Stripe is where it is set, and a number hardcoded in the UI is a number that
 *  will one day be wrong. */
const PLANS: { id: SubscriptionPlan; label: string; hint: string }[] = [
  { id: "monthly", label: "Monthly", hint: "Billed every month" },
  { id: "yearly", label: "Yearly", hint: "Billed once a year" },
]

/** What the browser was told when it came back from Stripe. `success` is not
 *  proof of anything — the webhook is — so it only sets the wording. */
export type CheckoutOutcome = "success" | "canceled" | null

/** How long to wait for the webhook before saying so. Stripe usually delivers
 *  within a couple of seconds; thirty is generous enough that giving up really
 *  does mean something is wrong, and short enough not to strand the user. */
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 10

export function BillingClient({
  organizationName,
  subscription,
  accessState,
  isOwner,
  checkoutOutcome,
}: {
  organizationName: string
  subscription: SessionSubscription | null
  accessState: AccessState
  isOwner: boolean
  checkoutOutcome: CheckoutOutcome
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [activePlan, setActivePlan] = useState<SubscriptionPlan | null>(null)
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false)

  const status = subscription?.status
  const copy = status ? STATUS_COPY[status] : null
  const hasAccess = accessState === "READY"
  const endingSoon = subscription?.cancelAtPeriodEnd === true

  // Paid, but the session this page rendered from does not know it yet.
  const confirmingCheckout = checkoutOutcome === "success" && !hasAccess
  const waitingForWebhook = confirmingCheckout && !gaveUpWaiting

  /**
   * Stripe sends the browser back the moment the card is accepted, but access
   * is granted by the webhook, which arrives separately and a beat later. There
   * is nothing to subscribe to for that, so the page asks — every few seconds,
   * for a bounded while — and stops as soon as the answer changes.
   */
  useEffect(() => {
    if (!waitingForWebhook) return

    let attempts = 0
    let stopped = false

    const timer = setInterval(async () => {
      attempts += 1

      let state: AccessState | null = null
      try {
        state = await refreshAccessState()
      } catch {
        // this attempt is simply ignored and the function will try again on the next interval.
      }

      if (stopped) return

      if (state === "READY") {
        clearInterval(timer)
        // The server action has already dropped the stale session entry, so
        // this re-render is what finally shows the subscription as active.
        router.refresh()
        return
      }

      if (attempts >= POLL_ATTEMPTS) {
        clearInterval(timer)
        setGaveUpWaiting(true)
      }
    }, POLL_INTERVAL_MS)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [waitingForWebhook, router])

  function checkout(plan: SubscriptionPlan) {
    setActivePlan(plan)
    startTransition(async () => {
      const [error, session] = await startCheckout(plan)

      if (error) {
        setActivePlan(null)
        toast.error(
          error.status === 403
            ? "Only an owner can change billing for this organization."
            : error.status === 409
              ? "This organization already has an active subscription."
              : "Could not open checkout. Please try again."
        )
        return
      }

      // Stripe's hosted page is a different origin, so this leaves the app
      // rather than going through the router.
      window.location.href = session.url
    })
  }

  function cancel() {
    startTransition(async () => {
      const error = await cancelSubscription()

      if (error) {
        toast.error(
          error.status === 403
            ? "Only an owner can change billing for this organization."
            : "Could not cancel the subscription. Please try again."
        )
        return
      }

      toast.success(
        "Subscription canceled. Access continues until the end of the paid period."
      )
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
        {/* Coming back from Stripe does not mean the subscription is live yet:
            the webhook that activates it may still be in flight. Saying
            "you're all set" before it lands would be a promise this page
            cannot keep. */}
        {waitingForWebhook && (
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
            <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Confirming your payment</p>
              <p className="text-sm text-muted-foreground">
                Stripe is still confirming this with us. This usually takes a
                few seconds.
              </p>
            </div>
          </div>
        )}

        {/* Giving up waiting is not the same as the payment failing, and the
            wording has to keep those apart — the money has very likely left
            the account, so "something went wrong" would be alarming and wrong. */}
        {confirmingCheckout && gaveUpWaiting && (
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                This is taking longer than expected
              </p>
              <p className="text-sm text-muted-foreground">
                Your payment went through, but we have not had confirmation from
                Stripe yet. Nothing is lost — check again in a moment, and
                contact support if it stays this way.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setGaveUpWaiting(false)}
              >
                Check again
              </Button>
            </div>
          </div>
        )}

        {checkoutOutcome === "canceled" && (
          <p className="text-sm text-muted-foreground">
            Checkout was canceled. Nothing has been charged.
          </p>
        )}

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
                {endingSoon ? "Ending" : copy.label}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">
              {endingSoon
                ? "This subscription is canceled and will not renew. Access continues until the end of the period you have paid for."
                : copy.description}
            </p>

            {subscription?.trialEndsAt && status === "trialing" && (
              <Row
                label="Trial ends"
                value={formatExpiry(subscription.trialEndsAt)}
              />
            )}
            {subscription?.currentPeriodEnd && (
              <Row
                label={endingSoon ? "Access ends" : "Renews"}
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

        {/* Checkout is offered whenever there is no access: that covers a
            first subscription and restarting a canceled or lapsed one. Not
            while a checkout is still being confirmed, though — the plan
            buttons under a "payment went through" message read as an
            invitation to pay twice. */}
        {isOwner &&
          !hasAccess &&
          !confirmingCheckout &&
          accessState !== "SUBSCRIPTION_UNKNOWN" && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Choose a plan</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {PLANS.map((plan) => (
                    <NotificationBadge
                      key={plan.id}
                      value={plan.id === "yearly" ? "Best value" : null}
                    >
                      <Button
                        variant={"outline"}
                        className={cn(
                          plan.id === "yearly"
                            ? "border-primary dark:border-primary"
                            : "",
                          "h-auto w-full flex-col items-start gap-0.5 p-4"
                        )}
                        onClick={() => checkout(plan.id)}
                        disabled={pending}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {pending && activePlan === plan.id && (
                            <Loader2 className="size-4 animate-spin" />
                          )}
                          {plan.label}
                        </span>
                        <span className="text-xs font-normal opacity-80">
                          {plan.hint}
                        </span>
                      </Button>
                    </NotificationBadge>
                  ))}
                </div>
                {/* Deliberately does not promise a trial: whether this user
                    still has one is decided server-side when checkout opens,
                    and Stripe's own page states the trial and the price before
                    anything is confirmed. */}
                <p className="text-xs text-muted-foreground">
                  You will be taken to Stripe. A payment method is required, and
                  the price and any free trial are shown before you confirm.
                </p>
              </div>
            </>
          )}

        {/* Only offered while there is something to cancel: a subscription
            already ending has nothing left to do here. */}
        {isOwner &&
          hasAccess &&
          !endingSoon &&
          subscription?.currentPeriodEnd && (
            <>
              <Separator />
              <Button variant="ghost" onClick={cancel} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Cancel subscription
              </Button>
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
