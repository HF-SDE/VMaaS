import { config } from "@/lib/config";
import { isTenantOwner } from "@/lib/rbac";

import { simulateSubscriptionEventSchema } from "@vmaas/shared/schemas";
import type { Request, Response } from "express";

import {
  getTenantSubscription,
  hasValidSubscription,
  markSubscriptionActive,
  markSubscriptionCanceled,
} from "../services/subscriptions.service";

/** The active tenant's billing state. Read-only — every mutation goes through
 *  the dev simulation below or, later, the Stripe webhook. */
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
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
      hasAccess: accessError ? false : hasAccess,
      isOwner: await isTenantOwner(req.session!.user.id, tenantId),
    })
    .end();
}

/**
 * DEVELOPMENT ONLY — stands in for the Stripe webhook that does not exist yet.
 *
 * This is the one place "pretend the payment succeeded" is written, and it does
 * not implement activation itself: it calls the same
 * `markSubscriptionActive` / `markSubscriptionCanceled` that the real webhook
 * handler will call. Deleting this controller and its route is the whole of
 * removing the simulation.
 *
 * Four things gate it, and all four matter:
 *   - `NODE_ENV !== "production"`, checked here as well as at mount time, so
 *     the handler is inert even if a future refactor mounts the route
 *     unconditionally;
 *   - `requireAuth`, so it is never an anonymous endpoint;
 *   - `requireTenant`, which resolves the tenant from the session and verifies
 *     membership — the body's `organizationId` is never trusted;
 *   - an explicit owner check, because billing belongs to the owner.
 */
export async function simulateSubscriptionEventController(req: Request, res: Response) {
  if (config.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" }).end();
  }

  const tenantId = req.tenantId!;
  const userId = req.session!.user.id;

  if (!(await isTenantOwner(userId, tenantId))) {
    return res.status(403).json({ error: "Only an owner can change billing for this tenant." }).end();
  }

  const { data, error: parseError } = simulateSubscriptionEventSchema.safeParse(req.body ?? {});
  if (parseError) {
    return res.status(400).json({ error: "Unrecognised simulated event." }).end();
  }

  // The event may name an organization, mirroring a real webhook payload, but
  // it is only ever compared against the session's tenant — never used to pick
  // one. A browser cannot activate a tenant it is not the owner of.
  if (data.organizationId && data.organizationId !== tenantId) {
    return res.status(403).json({ error: "That event is not for your active organization." }).end();
  }

  const suffix = tenantId.slice(0, 8);

  const [error, subscription] =
    data.type === "subscription.canceled"
      ? await markSubscriptionCanceled(tenantId)
      : await markSubscriptionActive(tenantId, {
          stripeCustomerId: data.customerId ?? `cus_dev_${suffix}`,
          stripeSubscriptionId: data.subscriptionId ?? `sub_dev_${suffix}`,
        });

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while updating the subscription" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json({ status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd }).end();
}
