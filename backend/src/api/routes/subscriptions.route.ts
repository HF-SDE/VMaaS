import { requireAuth, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";

import { createCheckoutSessionSchema, getInvoicesPageSchema } from "@vmaas/shared/schemas";
import express, { Router } from "express";

import {
  cancelSubscriptionController,
  createBillingPortalSessionController,
  createCheckoutSessionController,
  getSubscriptionController,
  listInvoicesController,
  stripeWebhookController,
} from "../controllers/subscriptions.controller";

/**
 * Stripe's webhook, mounted separately from everything below.
 *
 * It carries no `requireAuth`: Stripe has no session, and the signature check
 * in the controller is what authenticates it. It also needs the raw request
 * bytes, which is why `index.ts` mounts this router *before* `express.json()` —
 * a body that has been parsed and re-serialised no longer matches the signature
 * Stripe computed over it.
 */
export const subscriptionsWebhookRouter = Router();

subscriptionsWebhookRouter.post("/", express.raw({ type: "application/json" }), stripeWebhookController);

export const subscriptionsRouter = Router();

subscriptionsRouter.use(requireAuth);

// No `requirePermission`: every member may see whether their own organization
// is paid up — that is what the locked page tells them. Only changing billing
// is restricted, and that owner check lives in the controllers.
subscriptionsRouter.get("/current", requireTenant, getSubscriptionController);

// Owner-only, checked in the controller alongside the other billing actions.
// A literal path, so it must stay above any "/:id" added later.
//
// No `requireSubscription` here, unlike most routers: a tenant that has stopped
// paying still needs the receipts for the period it did pay for, and locking
// its own billing history behind an active subscription would be the one place
// the application withholds a record of money already taken.
subscriptionsRouter.get("/invoices", requireTenant, validate(getInvoicesPageSchema), listInvoicesController);

// No `requireSubscription` on either of these, for the obvious reason: they are
// how a tenant without one gets one, and how one that has it stops paying.
subscriptionsRouter.post(
  "/checkout",
  requireTenant,
  validate(createCheckoutSessionSchema),
  createCheckoutSessionController,
);

subscriptionsRouter.post("/cancel", requireTenant, cancelSubscriptionController);

// No `requireSubscription` either: a tenant whose card was declined is exactly
// the one that needs the portal, and its subscription is `past_due` by then.
// Locking the fix behind an active subscription would lock out the only people
// who need it.
subscriptionsRouter.post("/portal", requireTenant, createBillingPortalSessionController);
