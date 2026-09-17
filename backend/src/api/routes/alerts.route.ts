import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import { getAlertsPageSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import { getAlertsPageController } from "../controllers/alerts.controller";

export const alertsRouter = Router();

alertsRouter.use(requireAuth, requireTenant);

// Read-only for now: resolving an alert is `ALERT_RESOLVE`, and there is no
// endpoint for it yet. The log is the only thing reading these rows.
alertsRouter.get(
  "/paginated",
  requirePermission(PERMISSIONS.ALERT_READ),
  validate(getAlertsPageSchema),
  getAlertsPageController,
);
