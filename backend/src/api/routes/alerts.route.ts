import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { requireSubscription } from "@/api/middleware/require-subscription";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import { getAlertsPageSchema, resolveAlertSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import {
  getAlertsPageController,
  getAlertsSummaryController,
  resolveAlertController,
} from "../controllers/alerts.controller";

export const alertsRouter = Router();

alertsRouter.use(requireAuth, requireTenant, requireSubscription);

alertsRouter.get(
  "/paginated",
  requirePermission(PERMISSIONS.ALERT_READ),
  validate(getAlertsPageSchema),
  getAlertsPageController,
);

// A literal path, so it must stay above any "/:id" added later. No validate():
// the endpoint takes no input beyond the session's tenant.
alertsRouter.get("/summary", requirePermission(PERMISSIONS.ALERT_READ), getAlertsSummaryController);

alertsRouter.patch(
  "/:id/resolve",
  requirePermission(PERMISSIONS.ALERT_RESOLVE),
  validate(resolveAlertSchema),
  resolveAlertController,
);
