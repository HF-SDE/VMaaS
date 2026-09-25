import { isTenantOwner } from "@/lib/rbac";

import { getInvoicesPageSchema } from "@vmaas/shared/schemas";
import type { Request, Response } from "express";

import {
  cancelSubscription,
  createBillingPortalSession,
  createCheckoutSession,
  handleStripeWebhook,
  listInvoices,
} from "../services/billing.service";
import { getTenantSubscription, hasValidSubscription } from "../services/subscriptions.service";

/** The active tenant's billing state. Read-only — every mutation goes through
 *  Stripe and comes back as a webhook. */
export async function getSubscriptionController(req: Request, res: Response) {
  const tenantId = req.tenantId!;

  const [error, subscription] = await getTenantSubscription(tenantId);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the subscription" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  const [accessError, hasAccess] = await hasValidSubscription(tenantId);

  return res
    .status(200)
    .json({
      status: subscription.status,
      plan: subscription.plan,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      hasAccess: accessError ? false : hasAccess,
      isOwner: await isTenantOwner(req.session!.user.id, tenantId),
    })
    .end();
}

/**
 * Opens Stripe Checkout for the active tenant and returns the URL to send the
 * browser to.
 *
 * The tenant comes from `requireTenant`, which resolved it from the session and
 * verified membership — never from the body. The plan is the only thing taken
 * from the caller and it is a name, not a price: `createCheckoutSession` maps it
 * to a price id from the environment, so nobody can check out at a price they
 * chose. Ownership is checked because billing belongs to the owner.
 *
 * Nothing here grants access. The subscription becomes usable when Stripe's
 * webhook says it is active.
 */
export async function createCheckoutSessionController(req: Request, res: Response) {
  const tenantId = req.tenantId!;
  const user = req.session!.user;

  if (!(await isTenantOwner(user.id, tenantId))) {
    return res.status(403).json({ error: "Only an owner can change billing for this organization." }).end();
  }

  const [error, session] = await createCheckoutSession({
    tenantId,
    userId: user.id,
    plan: req.body.plan,
    userEmail: user.email,
  });

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "ALREADY_SUBSCRIBED":
        return res.status(409).json({ error: "This organization already has an active subscription." }).end();
      case "STRIPE_ERROR":
        return res.status(502).json({ error: "Could not reach Stripe. Please try again." }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while starting checkout" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(session).end();
}

/**
 * Cancels the active tenant's subscription at the end of the paid period.
 *
 * Same guards as checkout, for the same reasons: the tenant is the session's,
 * and only an owner may act on billing.
 */
export async function cancelSubscriptionController(req: Request, res: Response) {
  const tenantId = req.tenantId!;

  if (!(await isTenantOwner(req.session!.user.id, tenantId))) {
    return res.status(403).json({ error: "Only an owner can change billing for this organization." }).end();
  }

  const [error, result] = await cancelSubscription(tenantId);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "NO_STRIPE_SUBSCRIPTION":
        return res.status(409).json({ error: "This organization has no subscription to cancel." }).end();
      case "STRIPE_ERROR":
        return res.status(502).json({ error: "Could not reach Stripe. Please try again." }).end();
      case "UNKNOWN_TENANT":
        return res.status(404).json({ error: "No subscription was found for this organization." }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while canceling the subscription" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json({ cancelAtPeriodEnd: true, currentPeriodEnd: result.currentPeriodEnd }).end();
}

/**
 * Opens the Stripe Customer Portal for the active tenant and returns the URL to
 * send the browser to.
 *
 * Same guards as the other billing actions: the tenant comes from
 * `requireTenant`, and only an owner may act on billing — the portal is where
 * the card on file is changed, which is not something a member should reach.
 *
 * Nothing changes here. Whatever the tenant does in the portal comes back as a
 * webhook, exactly as checkout does.
 */
export async function createBillingPortalSessionController(req: Request, res: Response) {
  const tenantId = req.tenantId!;

  if (!(await isTenantOwner(req.session!.user.id, tenantId))) {
    return res.status(403).json({ error: "Only an owner can change billing for this organization." }).end();
  }

  const [error, session] = await createBillingPortalSession(tenantId);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "NO_STRIPE_CUSTOMER":
        return res.status(409).json({ error: "This organization has no billing details to manage yet." }).end();
      case "STRIPE_ERROR":
        return res.status(502).json({ error: "Could not reach Stripe. Please try again." }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while opening the billing portal" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(session).end();
}

/**
 * A page of the active tenant's receipts.
 *
 * Owner-only, like the other billing endpoints: an invoice carries amounts and
 * the billing address, which is more than the "are we paid up" that
 * `getSubscriptionController` deliberately shows every member.
 *
 * No `requireSubscription` on the route, and that is the point — a tenant that
 * has cancelled still needs the receipts for what it already paid for.
 *
 * The tenant is never read from the query. `listInvoices` asks Stripe about the
 * customer id on the tenant's own row, so there is no invoice id in this
 * request to point at somebody else's receipt.
 */
export async function listInvoicesController(req: Request, res: Response) {
  const tenantId = req.tenantId!;

  if (!(await isTenantOwner(req.session!.user.id, tenantId))) {
    return res.status(403).json({ error: "Only an owner can view billing history for this organization." }).end();
  }

  const { query } = getInvoicesPageSchema.parse(req);

  const [error, page] = await listInvoices(tenantId, query);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "STRIPE_ERROR":
        return res.status(502).json({ error: "Could not reach Stripe. Please try again." }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the invoices" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(page).end();
}

/**
 * Stripe's webhook endpoint.
 *
 * Unauthenticated by necessity — Stripe has no session — so the signature is
 * the whole of the authentication, and it is checked before anything is read
 * out of the payload. `req.body` is a Buffer here, not an object: the route
 * mounts `express.raw` because a re-serialised body does not verify.
 */
export async function stripeWebhookController(req: Request, res: Response) {
  const [error] = await handleStripeWebhook(req.body as Buffer, req.header("stripe-signature"));

  if (error) {
    const reason = error.reason;
    switch (reason) {
      // Covers both a payload that is not from Stripe and a failure to apply a
      // genuine one. 400 tells Stripe to redeliver, which is what a transient
      // database failure needs and costs nothing on a forged request.
      case "STRIPE_ERROR":
        return res.status(400).json({ error: error.message }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json({ received: true }).end();
}
