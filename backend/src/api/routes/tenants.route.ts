import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, ROLE_PERMISSIONS, TENANT_ROLES, listTenantsForUser } from "@/lib/rbac";

import { Router } from "express";

export const tenantsRouter = Router();

tenantsRouter.use(requireAuth);

// Roles a tenant admin is allowed to grant. Excludes platform roles, which
// are only ever assigned out-of-band (e.g. a seed script or DB migration).
const ASSIGNABLE_ROLES = Object.values(TENANT_ROLES) as string[];

tenantsRouter.get("/tenants", async (req, res) => {
  const tenants = await listTenantsForUser(req.session!.user.id);
  res.json({ tenants });
});

tenantsRouter.post("/tenants", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const ownerRole = await prisma.role.findUnique({ where: { name: TENANT_ROLES.OWNER } });
  if (!ownerRole) {
    res.status(500).json({ error: "Owner role is not seeded" });
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: name.trim(),
      userRoles: {
        create: { userId: req.session!.user.id, roleId: ownerRole.id },
      },
    },
  });

  res.status(201).json({ tenant });
});

tenantsRouter.get(
  "/tenants/:tenantId/members",
  requireTenant,
  requirePermission(PERMISSIONS.USER_VIEW),
  async (req, res) => {
    const members = await prisma.userRole.findMany({
      where: { tenantId: req.tenantId },
      include: { user: { select: { id: true, name: true, email: true } }, role: true },
    });
    res.json({ members });
  },
);

tenantsRouter.post(
  "/tenants/:tenantId/members",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  async (req, res) => {
    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId || !role || !ASSIGNABLE_ROLES.includes(role)) {
      res
        .status(400)
        .json({ error: `userId and role are required (role must be one of: ${ASSIGNABLE_ROLES.join(", ")})` });
      return;
    }

    const roleRecord = await prisma.role.findUnique({ where: { name: role } });
    if (!roleRecord) {
      res.status(400).json({ error: `Unknown role: ${role}` });
      return;
    }

    const membership = await prisma.userRole.upsert({
      where: { userId_roleId_tenantId: { userId, roleId: roleRecord.id, tenantId: req.tenantId! } },
      update: {},
      create: { userId, roleId: roleRecord.id, tenantId: req.tenantId! },
    });

    res.status(201).json({ membership });
  },
);

tenantsRouter.delete(
  "/tenants/:tenantId/members/:userId",
  requireTenant,
  requirePermission(PERMISSIONS.USER_MANAGE),
  async (req, res) => {
    const userId = req.params.userId as string;
    const tenantId = req.params.tenantId as string;

    const ownerRole = await prisma.role.findUnique({ where: { name: TENANT_ROLES.OWNER } });
    if (ownerRole) {
      const isOwner = await prisma.userRole.findUnique({
        where: { userId_roleId_tenantId: { userId, roleId: ownerRole.id, tenantId } },
      });
      if (isOwner) {
        const ownerCount = await prisma.userRole.count({ where: { tenantId, roleId: ownerRole.id } });
        if (ownerCount <= 1) {
          res.status(409).json({ error: "Cannot remove the last owner of a tenant" });
          return;
        }
      }
    }

    await prisma.userRole.deleteMany({ where: { userId, tenantId } });
    res.status(204).send();
  },
);

tenantsRouter.get("/roles", async (_req, res) => {
  res.json({
    roles: ASSIGNABLE_ROLES.map((name) => ({ name, permissions: ROLE_PERMISSIONS[name] ?? [] })),
  });
});
