import { requireAuth, requireTenant } from "@/api/middleware/auth";
import { config } from "@/lib/config";

import { Router } from "express";

import { getSubscriptionController, simulateSubscriptionEventController } from "../controllers/subscriptions.controller";

export const subscriptionsRouter = Router();

subscriptionsRouter.use(requireAuth);

// No `requirePermission`: every member may see whether their own organization
// is paid up — that is what the locked page tells them. Only changing billing
// is restricted, and that check lives in the controller.
subscriptionsRouter.get("/current", requireTenant, getSubscriptionController);

// DEVELOPMENT ONLY. Not mounted at all in production, and the controller
// re-checks `NODE_ENV` even so. Remove both when Stripe's webhook lands.
if (config.NODE_ENV !== "production") {
  subscriptionsRouter.post("/dev/simulate", requireTenant, simulateSubscriptionEventController);
}
