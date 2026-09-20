import { type subscription_status } from "@/generated/prisma/client";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { STRIPE_PRICE_IDS, stripe } from "@/lib/stripe";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { SubscriptionPlan } from "@vmaas/shared/schemas";
import type Stripe from "stripe";

import { getTenantSubscription, grantsAccess, setSubscriptionStatus } from "./subscriptions.service";

/**
 * Everything that talks to Stripe.
 *
 * `subscriptions.service.ts` owns the `subscriptions` table and knows nothing
 * about Stripe; this file owns the Stripe vocabulary — checkout sessions,
 * events, price ids, Stripe's own status strings — and translates it into a
 * single `setSubscriptionStatus` call. Neither file grows a second definition
 * of what "paid" means.
 */

export type StripeApiError = { reason: "STRIPE_ERROR"; message: string };
export type UnknownBillingError = { reason: "UNKNOWN_ERROR"; message: string };
export type AlreadySubscribedError = { reason: "ALREADY_SUBSCRIBED"; message: string };
export type NoStripeSubscriptionError = { reason: "NO_STRIPE_SUBSCRIPTION"; message: string };
export type UnknownTenantError = { reason: "UNKNOWN_TENANT"; message: string };

/**
 * A label for this checkout flow in the Stripe dashboard, so sessions from the
 * application can be told apart from ones opened by hand. The random suffix is
 * part of the convention and must not be regenerated — changing it starts a new
 * series and orphans the history of the old one.
 */
const INTEGRATION_IDENTIFIER = "vmaas-tenant-billing-qwrtkzpm";

function unknownError(action: string, cause: unknown): Result<UnknownBillingError, never> {
  // TODO: capture sentry error
  console.error(`[billing.service] ${action} failed`, cause);

  return err({ reason: "UNKNOWN_ERROR", message: `An unknown error occurred while ${action}.` });
}

/** Stripe errors are separated from ours so the controller can say "Stripe
 *  refused this" rather than reporting a 500 the application did not cause. */
function stripeError(action: string, cause: unknown): Result<StripeApiError, never> {
  console.error(`[billing.service] stripe ${action} failed`, cause);

  return err({ reason: "STRIPE_ERROR", message: `Stripe could not complete ${action}.` });
}

/**
 * Stripe's subscription statuses onto ours.
 *
 * The default arm is the important one: an unrecognised status must land on a
 * state that denies access, because the alternative is a status Stripe added
 * after this was written silently reading as "paid".
 */
function toSubscriptionStatus(status: Stripe.Subscription.Status): subscription_status {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    case "canceled":
    case "paused":
    default:
      return "canceled";
  }
}

function toDate(seconds: number | null | undefined): Date | undefined {
  return typeof seconds === "number" ? new Date(seconds * 1000) : undefined;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * When the current billing period ends.
 *
 * Since the Basil API version this lives on the subscription's *items*, not on
 * the subscription — `subscription.current_period_end` no longer exists. Items
 * on one subscription share a period, so the first one answers for all of them.
 */
function currentPeriodEnd(subscription: Stripe.Subscription): Date | undefined {
  return toDate(subscription.items.data[0]?.current_period_end);
}

/**
 * Which tenant a Stripe subscription belongs to.
 *
 * Resolved through the identifiers already stored on the row — the Stripe
 * object graph — rather than through `metadata`, which is a snapshot anyone
 * with dashboard access can edit. The metadata written at checkout is only a
 * fallback, for the first event of a subscription whose ids we have not
 * recorded yet, and even then the tenant must exist.
 */
async function tenantIdFor(subscription: Stripe.Subscription): Promise<string | null> {
  const customerId = idOf(subscription.customer);

  const existing = await prisma.subscription.findFirst({
    where: {
      OR: [{ stripeSubscriptionId: subscription.id }, ...(customerId ? [{ stripeCustomerId: customerId }] : [])],
    },
    select: { tenantId: true },
  });

  if (existing) return existing.tenantId;

  const claimed = subscription.metadata?.tenantId;
  if (!claimed) return null;

  const tenant = await prisma.tenant.findUnique({ where: { id: claimed }, select: { id: true } });

  return tenant?.id ?? null;
}

/**
 * Writes a Stripe subscription onto its tenant's row.
 *
 * The single path from "Stripe says X" to "this tenant may/may not use the
 * application", so every event type below funnels through here and none of them
 * decides access for itself.
 */
export async function applyStripeSubscription(
  subscription: Stripe.Subscription,
): Promise<Result<UnknownTenantError | UnknownBillingError, { tenantId: string }>> {
  const tenantId = await tenantIdFor(subscription);

  // Not an error worth retrying: the subscription belongs to something else in
  // this Stripe account, or to a tenant that has since been deleted. The
  // webhook acknowledges it rather than making Stripe redeliver forever.
  if (!tenantId) {
    return err({
      reason: "UNKNOWN_TENANT",
      message: `No tenant matches Stripe subscription ${subscription.id}.`,
    });
  }

  const [error] = await setSubscriptionStatus(tenantId, toSubscriptionStatus(subscription.status), {
    stripeCustomerId: idOf(subscription.customer),
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: currentPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEndsAt: toDate(subscription.trial_end) ?? null,
  });

  if (error) return err(error);

  return ok({ tenantId });
}

/** Re-reads a subscription from Stripe and applies it. Used by the events that
 *  name a subscription but do not carry it, so one fetch keeps every handler
 *  working from the subscription's current state rather than a stale echo. */
export async function applyStripeSubscriptionById(
  subscriptionId: string,
): Promise<Result<UnknownTenantError | UnknownBillingError | StripeApiError, { tenantId: string }>> {
  try {
    return await applyStripeSubscription(await stripe.subscriptions.retrieve(subscriptionId));
  } catch (error) {
    return stripeError("reading the subscription", error);
  }
}

/**
 * A Stripe Checkout session for one of the two plans.
 *
 * `plan` is a name, not a price — the price ids are read from the environment
 * here, so a caller cannot check out against a price of their own choosing. The
 * tenant comes from the session via the controller and is written to both the
 * session and the subscription's metadata, which is what lets the very first
 * webhook find its tenant before any id has been stored.
 *
 * Creating the session grants nothing. Access is granted by the webhook, when
 * Stripe says the subscription is active.
 */
export async function createCheckoutSession(input: {
  tenantId: string;
  plan: SubscriptionPlan;
  userEmail: string;
}): Promise<Result<AlreadySubscribedError | StripeApiError | UnknownBillingError, { url: string }>> {
  const [loadError, subscription] = await getTenantSubscription(input.tenantId);
  if (loadError) return err(loadError);

  // Without this a second checkout would create a second Stripe subscription
  // for the same tenant, and the tenant would be billed twice for one seat.
  if (grantsAccess(subscription.status) && subscription.stripeSubscriptionId) {
    return err({
      reason: "ALREADY_SUBSCRIBED",
      message: "This organization already has an active subscription.",
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // No `payment_method_types`: omitting it is what lets Stripe pick the
      // methods most likely to convert for this customer, configured from the
      // dashboard rather than from here.
      line_items: [{ price: STRIPE_PRICE_IDS[input.plan], quantity: 1 }],
      // Reuse the customer if this tenant has one, so a resubscribe lands on
      // the same Stripe customer and its payment methods instead of a new one.
      ...(subscription.stripeCustomerId
        ? { customer: subscription.stripeCustomerId }
        : { customer_email: input.userEmail }),
      client_reference_id: input.tenantId,
      metadata: { tenantId: input.tenantId },
      subscription_data: { metadata: { tenantId: input.tenantId } },
      success_url: `${config.APP_URL}/billing?checkout=success`,
      cancel_url: `${config.APP_URL}/billing?checkout=canceled`,
      integration_identifier: INTEGRATION_IDENTIFIER,
    });

    // Stripe returns no URL for an embedded session; this integration is hosted
    // checkout, so a missing URL is a broken response, not something to pass on
    // to the browser as `undefined`.
    if (!session.url) return stripeError("opening checkout", new Error("session has no url"));

    return ok({ url: session.url });
  } catch (error) {
    return stripeError("opening checkout", error);
  }
}

/**
 * Cancels a tenant's subscription at the end of the period it has paid for.
 *
 * Not an immediate cancellation: the tenant paid through `currentPeriodEnd` and
 * taking the application away before then would be taking back something sold.
 * Stripe keeps the subscription `active` until that date and then sends
 * `customer.subscription.deleted`, so the row here is updated twice — once now
 * with `cancelAtPeriodEnd`, and once by the webhook when access actually ends.
 */
export async function cancelSubscription(
  tenantId: string,
): Promise<
  Result<
    NoStripeSubscriptionError | StripeApiError | UnknownTenantError | UnknownBillingError,
    { currentPeriodEnd: Date | null }
  >
> {
  const [loadError, subscription] = await getTenantSubscription(tenantId);
  if (loadError) return err(loadError);

  if (!subscription.stripeSubscriptionId) {
    return err({
      reason: "NO_STRIPE_SUBSCRIPTION",
      message: "This organization has no subscription to cancel.",
    });
  }

  let canceled: Stripe.Subscription;
  try {
    canceled = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (error) {
    return stripeError("canceling the subscription", error);
  }

  // Written straight back rather than left to the `customer.subscription.updated`
  // webhook this triggers: the owner is about to be shown the result, and a
  // page that still says "renews" because the event has not arrived yet reads
  // as a cancellation that did not work.
  const [applyError] = await applyStripeSubscription(canceled);
  if (applyError) return err(applyError);

  return ok({ currentPeriodEnd: currentPeriodEnd(canceled) ?? null });
}

/**
 * Verifies a webhook request and applies it.
 *
 * `body` must be the raw bytes Express received. Signature verification is over
 * the exact payload Stripe signed, so anything that has been through
 * `express.json()` — parsed and re-serialised — fails to verify even when it is
 * genuine.
 *
 * Only the events that change whether a tenant may use the application are
 * handled; the rest are acknowledged and ignored, because a 4xx makes Stripe
 * redeliver an event nothing here will ever act on.
 */
export async function handleStripeWebhook(
  body: Buffer,
  signature: string | undefined,
): Promise<Result<StripeApiError, { received: true }>> {
  if (!signature) return err({ reason: "STRIPE_ERROR", message: "Missing Stripe signature." });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    // The one case that must stay a 4xx: an unverified payload is not from
    // Stripe, and asking Stripe to redeliver it would be pointless anyway.
    console.error("[billing.service] webhook signature verification failed", error);
    return err({ reason: "STRIPE_ERROR", message: "Invalid Stripe signature." });
  }

  const result = await applyEvent(event);

  // A tenant we cannot resolve is logged and acknowledged — see
  // `applyStripeSubscription`. A database failure is not: returning an error
  // makes Stripe retry, which is exactly what a transient failure needs.
  if (result && result[0]) {
    const { reason, message } = result[0];

    if (reason === "UNKNOWN_TENANT") {
      console.warn(`[billing.service] ${event.type}: ${message}`);
    } else {
      return err({ reason: "STRIPE_ERROR", message });
    }
  }

  return ok({ received: true });
}

type ApplyResult = Awaited<ReturnType<typeof applyStripeSubscriptionById>>;

/** Returns `null` for an event this application does not act on. */
async function applyEvent(event: Stripe.Event): Promise<ApplyResult | null> {
  switch (event.type) {
    // The subscription's own lifecycle: creation, renewal, plan change, a
    // failed payment moving it to past_due, and the end of a cancelation.
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return applyStripeSubscription(event.data.object);

    // Checkout finishing is not itself proof of payment: with a delayed
    // notification method the session completes while still unpaid. The
    // subscription it created is the authority, so this only fetches it.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.mode !== "subscription" || session.payment_status === "unpaid") return null;

      const subscriptionId = idOf(session.subscription);
      return subscriptionId ? applyStripeSubscriptionById(subscriptionId) : null;
    }

    // Renewals and dunning. Both also produce a subscription event, but not
    // always in a useful order, and re-reading the subscription is idempotent.
    case "invoice.paid":
    case "invoice.payment_failed": {
      const subscriptionId = idOf(event.data.object.parent?.subscription_details?.subscription);
      return subscriptionId ? applyStripeSubscriptionById(subscriptionId) : null;
    }

    default:
      return null;
  }
}
