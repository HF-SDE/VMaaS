import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import { createProductSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import {
  createProductsController,
  getProductsController,
  getProductsPageController,
} from "../controllers/products.controller";

export const productsRouter = Router();

productsRouter.use(requireAuth, requireTenant);

productsRouter.get("/", requirePermission(PERMISSIONS.PRODUCT_READ), getProductsController);
productsRouter.get("/paginated", requirePermission(PERMISSIONS.PRODUCT_READ), getProductsPageController);
productsRouter.post(
  "/",
  requirePermission(PERMISSIONS.PRODUCT_WRITE),
  validate(createProductSchema),
  createProductsController,
);
