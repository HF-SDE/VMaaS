import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { PERMISSIONS } from "@/lib/rbac";

import { Router } from "express";

import { createProductsController, getProductsController } from "../controllers/products.controller";

const router = Router();

router.use(requireAuth, requireTenant);

router.get("/", requirePermission(PERMISSIONS.PRODUCT_READ), getProductsController);
router.post("/", requirePermission(PERMISSIONS.PRODUCT_WRITE), createProductsController);

export default router;
