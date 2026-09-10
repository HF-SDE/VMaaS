import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { PERMISSIONS } from "@/lib/rbac";

import { Router } from "express";

import {
  addMemberController,
  createTenantController,
  getMembersController,
  getRolesController,
  getTenantsController,
  removeMemberController,
} from "../controllers/tenants.controller";

export const tenantsRouter = Router();

tenantsRouter.use(requireAuth);

tenantsRouter.get("/", getTenantsController);
tenantsRouter.get("/:tenantId/members", requireTenant, requirePermission(PERMISSIONS.USER_VIEW), getMembersController);
tenantsRouter.get("/roles", getRolesController);

tenantsRouter.post("/", createTenantController);
tenantsRouter.post(
  "/:tenantId/members",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  addMemberController,
);

tenantsRouter.delete(
  "/:tenantId/members/:userId",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  removeMemberController,
);
