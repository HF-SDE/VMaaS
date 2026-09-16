import { PERMISSIONS } from "@vmaas/shared/types";
import { Router } from "express";

import { getSalesController } from "../controllers/sales.controller";
import { requireAuth, requirePermission, requireTenant } from "../middleware/auth";

export const salesRouter = Router();

salesRouter.use(requireAuth, requireTenant);

salesRouter.get("/", requirePermission(PERMISSIONS.SALE_READ), getSalesController);
