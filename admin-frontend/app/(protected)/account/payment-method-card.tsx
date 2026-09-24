"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { CreditCard, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { openBillingPortal } from "@/app/(onboarding)/actions"

/**
 * Where the card on file gets changed.
 *
 * No card details are shown or collected here — the button hands the browser to
 * Stripe's own portal, which is what keeps this application out of the path of
 * a card number entirely. Nothing to invalidate on the way out: the change
 * happens on Stripe and comes back as a webhook.
 *
 * Owner-only, and enforced by the backend rather than hidden here: a member who
 * clicks it is told so, which is more use than a button that is not there.
 */
export function PaymentMethodCard() {
  const [pending, startTransition] = useTransition()

  function openPortal() {
    startTransition(async () => {
      const [error, session] = await openBillingPortal()

      if (error) {
        toast.error(
          error.status === 403
            ? "Only an owner can change billing for this organization."
            : error.status === 409
              ? "This organization has no billing details to manage yet."
              : "Could not open the billing portal. Please try again."
        )
        return
      }

      // Stripe's portal is a different origin, so this leaves the app rather
      // than going through the router.
      window.location.href = session.url
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage your subscription</CardTitle>
        <CardDescription>
          Update your billing information, payment method, and subscription
          through Stripe&apos;s secure portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={openPortal} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <CreditCard />}
          Manage subscription
        </Button>
      </CardContent>
    </Card>
  )
}
