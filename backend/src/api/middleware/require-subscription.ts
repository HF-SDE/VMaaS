import { hasValidSubscription } from "@/api/services/subscriptions.service";

import type { NextFunction, Request, Response } from "express";

/**
 * Refuses a request whose tenant has no valid subscription. Must run after
 * `requireTenant`, which is what establishes `req.tenantId`.
 *
 * This is the server-side half of the paywall. The frontend's access resolver
 * decides what to *render*; this decides what the API will *answer*, so a
 * client that ignores the redirect — or a subscription that lapses mid-session
 * — still gets 402 rather than data.
 *
 * 402 Payment Required rather than 403: the caller is who they say they are and
 * may well hold the permission, so the frontend has to tell this apart from a
 * genuine authorization failure to route them to billing instead of /forbidden.
 */
export async function requireSubscription(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.tenantId;

  if (!tenantId) {
    res.status(400).json({ error: "No tenant selected" });
    return;
  }

  const [error, isValid] = await hasValidSubscription(tenantId);

  // A failed lookup is not a licence to serve the data — fail closed.
  if (error) {
    res.status(503).json({ error: "Could not verify the subscription for this organization." });
    return;
  }

  if (!isValid) {
    res.status(402).json({ error: "This organization does not have an active subscription." });
    return;
  }

  next();
}
