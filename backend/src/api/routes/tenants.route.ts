import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { PERMISSIONS } from "@/lib/rbac";

import { Router } from "express";

import {
  createRoleController,
  createTenantController,
  deleteRoleController,
  getInviteController,
  getMembersController,
  getMembersPageController,
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
tenantsRouter.get("/members", requireTenant, requirePermission(PERMISSIONS.USER_VIEW), getMembersController);
// Must stay above "/members/:userId", which would otherwise match "paginated" as a user id.
tenantsRouter.get(
  "/members/paginated",
  requireTenant,
  requirePermission(PERMISSIONS.USER_VIEW),
  getMembersPageController,
);
tenantsRouter.get("/roles", requireTenant, requirePermission(PERMISSIONS.ROLE_VIEW), getRolesController);

// Invitation endpoints take `requireAuth` only — deliberately not
// `requireTenant`. The user reading or accepting an invitation is by definition
// not yet a member of the tenant it names, so membership cannot be the gate;
// the service checks that the invited address is the signed-in one instead.
tenantsRouter.get("/invites/:inviteId", getInviteController);
tenantsRouter.post("/invites/:inviteId/respond", respondToInviteController);

tenantsRouter.post("/", createTenantController);
tenantsRouter.post("/members", requireTenant, requirePermission(PERMISSIONS.USER_MANAGE), inviteMemberController);
tenantsRouter.post("/roles", requireTenant, requirePermission(PERMISSIONS.ROLE_MANAGE), createRoleController);

tenantsRouter.put(
  "/members/:userId/role",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  updateMemberRoleController,
);
tenantsRouter.patch("/roles/:roleId", requireTenant, requirePermission(PERMISSIONS.ROLE_MANAGE), updateRoleController);

tenantsRouter.delete(
  "/members/:userId",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  removeMemberController,
);
tenantsRouter.delete("/roles/:roleId", requireTenant, requirePermission(PERMISSIONS.ROLE_MANAGE), deleteRoleController);
