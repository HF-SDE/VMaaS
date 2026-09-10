import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { PERMISSIONS } from "@/lib/rbac";

import { Router } from "express";

import { createProductsController, getProductsController } from "../controllers/products.controller";

export const productsRouter = Router();

productsRouter.use(requireAuth, requireTenant);

productsRouter.get("/", requirePermission(PERMISSIONS.PRODUCT_READ), getProductsController);
productsRouter.post("/", requirePermission(PERMISSIONS.PRODUCT_WRITE), createProductsController);
