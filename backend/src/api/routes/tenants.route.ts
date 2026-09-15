import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { PERMISSIONS } from "@/lib/rbac";

import { Router } from "express";

import {
  createRoleController,
  createTenantController,
  deleteRoleController,
  getMembersController,
  getRolesController,
  getTenantsController,
  inviteMemberController,
  removeMemberController,
  respondToInviteController,
  updateMemberRoleController,
  updateRoleController,
} from "../controllers/tenants.controller";

export const tenantsRouter = Router();

tenantsRouter.use(requireAuth);

tenantsRouter.get("/", getTenantsController);
tenantsRouter.get("/:tenantId/members", requireTenant, requirePermission(PERMISSIONS.USER_VIEW), getMembersController);
tenantsRouter.get("/roles", requireTenant, requirePermission(PERMISSIONS.ROLE_VIEW), getRolesController);

tenantsRouter.post("/", createTenantController);
tenantsRouter.post(
  "/:tenantId/members",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  inviteMemberController,
);
tenantsRouter.post("/respond-to-invite/:token", respondToInviteController);
tenantsRouter.post("/roles", requireTenant, requirePermission(PERMISSIONS.ROLE_MANAGE), createRoleController);

tenantsRouter.put(
  "/members/:userId/role",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  updateMemberRoleController,
);
tenantsRouter.patch("/roles/:roleId", requireTenant, requirePermission(PERMISSIONS.ROLE_MANAGE), updateRoleController);

tenantsRouter.delete(
  "/:tenantId/members/:userId",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  removeMemberController,
);
tenantsRouter.delete("/roles/:roleId", requireTenant, requirePermission(PERMISSIONS.ROLE_MANAGE), deleteRoleController);
