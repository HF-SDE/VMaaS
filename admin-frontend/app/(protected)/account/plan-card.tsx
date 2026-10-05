import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { SessionSubscription } from "@/lib/session"
import type { SubscriptionPlan } from "@vmaas/shared/schemas"
import type { SubscriptionStatus } from "@vmaas/shared/types"

/** What each billing state is called, and whether it is something the owner
 *  needs to act on. Kept short: this card states where the organization stands,
 *  the paywall is where a state gets explained. */
const STATUS_LABELS: Record<
  SubscriptionStatus,
  { label: string; tone: "default" | "secondary" | "destructive" }
> = {
  pending: { label: "Not started", tone: "secondary" },
  trialing: { label: "Trial", tone: "default" },
  active: { label: "Active", tone: "default" },
  past_due: { label: "Past due", tone: "destructive" },
  canceled: { label: "Canceled", tone: "secondary" },
  incomplete: { label: "Incomplete", tone: "destructive" },
  unpaid: { label: "Unpaid", tone: "destructive" },
}

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
}

/** Dates arrive as ISO strings on the session, not as Date objects. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
}

/**
 * What the organization is paying for, and until when.
 *
 * Read from the session rather than fetched: `getSession` already carries the
 * billing state, so naming the plan here costs no request — not to this API and
 * not to Stripe. It is up to 60 seconds stale, which is the same freshness the
 * paywall decides access on.
 *
 * A server component on purpose. Nothing here is interactive; the one button in
 * this tab lives in its own client component next door, so opening the account
 * page ships no JavaScript for this card.
 */
export function PlanCard({
  subscription,
}: {
  subscription: SessionSubscription | null
}) {
  // `null` is "the lookup failed", never "not subscribed" — that is the
  // `pending` status. Saying "no plan" here would tell a paying owner their
  // subscription had vanished.
  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>
            Your billing state could not be loaded. Please refresh the page.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const status = STATUS_LABELS[subscription.status]
  const plan = subscription.plan ? PLAN_LABELS[subscription.plan] : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {/* Null before checkout, and for a price the backend does not
              recognise. Neither is a plan worth naming. */}
          {plan ?? "No plan yet"}
          <Badge variant={status.tone}>{status.label}</Badge>
        </CardTitle>
        <CardDescription>
          What this organization is being billed for.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <dl className="grid gap-2">
          {subscription.status === "trialing" && subscription.trialEndsAt && (
            <Row
              term="Trial ends"
              value={formatDate(subscription.trialEndsAt)}
            />
          )}

          {subscription.currentPeriodEnd && (
            <Row
              // Stripe keeps a canceled subscription active until the period
              // runs out, so the same date means two different things and the
              // flag is the only thing that tells them apart.
              term={subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"}
              value={formatDate(subscription.currentPeriodEnd)}
            />
          )}

          {!subscription.currentPeriodEnd && !subscription.trialEndsAt && (
            <p>No billing period has started yet.</p>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{term}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}
