import { getSalesMapSchema, getSalesSummarySchema } from "@vmaas/shared/schemas";
import { PERMISSIONS } from "@vmaas/shared/types";
import { Router } from "express";

import { getSalesController, getSalesMapController, getSalesSummaryController } from "../controllers/sales.controller";
import { requireAuth, requirePermission, requireTenant } from "../middleware/auth";
import { requireSubscription } from "@/api/middleware/require-subscription";
import { validate } from "../middleware/validate";

export const salesRouter = Router();

salesRouter.use(requireAuth, requireTenant, requireSubscription);

// A literal path, so it must stay above any "/:id" added later.
salesRouter.get("/map", requirePermission(PERMISSIONS.SALE_READ), validate(getSalesMapSchema), getSalesMapController);
salesRouter.get(
  "/summary",
  requirePermission(PERMISSIONS.SALE_READ),
  validate(getSalesSummarySchema),
  getSalesSummaryController,
);
salesRouter.get("/", requirePermission(PERMISSIONS.SALE_READ), getSalesController);
