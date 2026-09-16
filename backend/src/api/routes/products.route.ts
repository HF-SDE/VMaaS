import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import {
  createProductSchema,
  getProductsPageSchema,
  productIdParamsSchema,
  updateProductSchema,
} from "@vmaas/shared/schemas";
import { Router } from "express";

import {
  archiveProductController,
  createProductsController,
  deleteProductController,
  getProductController,
  getProductsController,
  getProductsPageController,
  unarchiveProductController,
  updateProductController,
} from "../controllers/products.controller";

export const productsRouter = Router();

productsRouter.use(requireAuth, requireTenant);

productsRouter.get("/", requirePermission(PERMISSIONS.PRODUCT_READ), getProductsController);
// Must stay above "/:id", which would otherwise match "paginated" as an id.
productsRouter.get(
  "/paginated",
  requirePermission(PERMISSIONS.PRODUCT_READ),
  validate(getProductsPageSchema),
  getProductsPageController,
);
productsRouter.post(
  "/",
  requirePermission(PERMISSIONS.PRODUCT_WRITE),
  validate(createProductSchema),
  createProductsController,
);

productsRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.PRODUCT_READ),
  validate(productIdParamsSchema),
  getProductController,
);
productsRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.PRODUCT_WRITE),
  validate(updateProductSchema),
  updateProductController,
);
productsRouter.delete(
  "/:id",
  requirePermission(PERMISSIONS.PRODUCT_WRITE),
  validate(productIdParamsSchema),
  deleteProductController,
);

// Their own verbs rather than a flag on PATCH: archiving is a state change of
// its own, and this keeps it from riding along unnoticed in a field update.
productsRouter.post(
  "/:id/archive",
  requirePermission(PERMISSIONS.PRODUCT_WRITE),
  validate(productIdParamsSchema),
  archiveProductController,
);
productsRouter.post(
  "/:id/unarchive",
  requirePermission(PERMISSIONS.PRODUCT_WRITE),
  validate(productIdParamsSchema),
  unarchiveProductController,
);
