import { requireAuth, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";

import { createCheckoutSessionSchema } from "@vmaas/shared/schemas";
import express, { Router } from "express";

import {
  cancelSubscriptionController,
  createCheckoutSessionController,
  getSubscriptionController,
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

// No `requireSubscription` on either of these, for the obvious reason: they are
// how a tenant without one gets one, and how one that has it stops paying.
subscriptionsRouter.post(
  "/checkout",
  requireTenant,
  validate(createCheckoutSessionSchema),
  createCheckoutSessionController,
);

subscriptionsRouter.post("/cancel", requireTenant, cancelSubscriptionController);
