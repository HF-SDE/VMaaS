import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import { Router } from "express";
import { z } from "zod/v4";

import { createProductsController, getProductsController } from "../controllers/products.controller";

export const productsRouter = Router();

productsRouter.use(requireAuth, requireTenant);

const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, { message: "name is required" }),
    price: z.number().positive({ message: "price must be a positive number" }),
  }),
});

productsRouter.get("/", requirePermission(PERMISSIONS.PRODUCT_READ), getProductsController);
productsRouter.post(
  "/",
  requirePermission(PERMISSIONS.PRODUCT_WRITE),
  validate(createProductSchema),
  createProductsController,
);
