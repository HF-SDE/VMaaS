import { prisma } from "@/lib/prisma";
import { DEFAULT_TENANT_ROLES, ROLE_PERMISSIONS, createRolesWithPermissions, listTenantsForUser } from "@/lib/rbac";

import { InviteResponses } from "@vmaas/shared/types/tenants";
import { APIError } from "better-auth";

export const DEFAULT_ROLES = Object.values(DEFAULT_TENANT_ROLES) as string[];

export async function getTenantsService(userId: string) {
  return listTenantsForUser(userId);
}

export async function getMembersService(tenantId: string) {
  const members = await prisma.userRole.findMany({
    where: { tenantId },
    include: { user: { select: { id: true, name: true, email: true } }, role: true },
  });

  return members;
}

export async function createTenantService(userId: string, name: string) {
  const tenant = await prisma.tenant.create({ data: { name } });

  await createRolesWithPermissions(tenant.id, DEFAULT_ROLES);

  const ownerRole = await prisma.role.findFirst({ where: { name: DEFAULT_TENANT_ROLES.OWNER, tenantId: tenant.id } });
  if (!ownerRole) return { ok: false as const, error: "Owner role is not seeded", status: 500 };

  await prisma.userRole.create({ data: { userId, roleId: ownerRole.id, tenantId: tenant.id } });

  return { ok: true as const, tenant };
}

export async function inviteMemberService(tenantId: string, email: string, invitedById: string, role: string) {
  const roleRecord = await prisma.role.findFirst({ where: { name: role, tenantId } });
  if (!roleRecord) throw new APIError("BAD_REQUEST", { message: `Unknown role: ${role}` });
  const roleId = roleRecord?.id;

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) throw new APIError("NOT_FOUND", { message: `User with email ${email} not found` });
  const userId = user.id;

  const expireAfterDays = 7;
  const expiresAt = new Date(Date.now() + expireAfterDays * 24 * 60 * 60 * 1000);

  const membership = await prisma.tenantInvite.upsert({
    where: { userId_tenantId_status: { userId, tenantId, status: "pending" } },
    update: { roleId },
    create: { userId, tenantId, roleId, expiresAt, token: crypto.randomUUID(), invitedById },
  });

  return { ok: true as const, membership };
}

export async function respondToInviteService(token: string, userId: string, status: InviteResponses) {
  const invite = await prisma.tenantInvite.findUnique({ where: { token } });

  if (!invite) throw new APIError("NOT_FOUND", { message: "Invite not found" });
  if (invite.userId !== userId) throw new APIError("FORBIDDEN", { message: "This invite is not for you" });
  if (invite.status !== "pending") throw new APIError("BAD_REQUEST", { message: "This invite is no longer valid" });
  if (invite.expiresAt < new Date()) throw new APIError("BAD_REQUEST", { message: "This invite has expired" });

  await prisma.userRole.create({ data: { userId, tenantId: invite.tenantId, roleId: invite.roleId } });

  await prisma.tenantInvite.update({ where: { id: invite.id }, data: { status } });

  return { ok: true as const };
}

export async function removeMemberService(tenantId: string, userId: string) {
  const ownerRole = await prisma.role.findFirst({ where: { name: DEFAULT_TENANT_ROLES.OWNER, tenantId } });
  if (ownerRole) {
    const isOwner = await prisma.userRole.findUnique({
      where: { userId_roleId_tenantId: { userId, roleId: ownerRole.id, tenantId } },
    });
    if (isOwner) {
      const ownerCount = await prisma.userRole.count({ where: { tenantId, roleId: ownerRole.id } });
      if (ownerCount <= 1) {
        return { ok: false as const, error: "Cannot remove the last owner of a tenant", status: 409 };
      }
    }
  }

  await prisma.userRole.deleteMany({ where: { userId, tenantId } });
  return { ok: true as const };
}

export async function getRolesService(tenantId: string) {
  const tenantRolesWithPermissions = await prisma.role.findMany({
    where: { tenantId },
    include: { rolePermissions: { include: { permission: true } } },
  });

  const rolesWithPermissions = tenantRolesWithPermissions.map((role) => ({
    id: role.id,
    name: role.name,
    permissions: role.rolePermissions.map((rp) => rp.permission.key),
  }));

  return rolesWithPermissions;
}

export async function createRoleService(tenantId: string, name: string, permissions: string[]) {
  const existing = await prisma.role.findFirst({ where: { tenantId, name } });
  if (existing) return { ok: false as const, error: "A role with that name already exists", status: 409 };

  const role = await prisma.role.create({ data: { name, tenantId } });

  if (permissions.length > 0) {
    const permissionRecords = await prisma.permission.findMany({ where: { key: { in: permissions } } });
    await prisma.rolePermission.createMany({
      data: permissionRecords.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }

  return { ok: true as const, role };
}

export async function updateRoleService(
  tenantId: string,
  roleId: string,
  updates: { name?: string; permissions?: string[] },
) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) return { ok: false as const, error: "Role not found", status: 404 };

  if (updates.name && updates.name !== role.name) {
    const existing = await prisma.role.findFirst({ where: { tenantId, name: updates.name } });
    if (existing) return { ok: false as const, error: "A role with that name already exists", status: 409 };

    await prisma.role.update({ where: { id: roleId }, data: { name: updates.name } });
  }

  if (updates.permissions) {
    const permissionRecords = await prisma.permission.findMany({ where: { key: { in: updates.permissions } } });

    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.rolePermission.createMany({
      data: permissionRecords.map((permission) => ({ roleId, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }

  return { ok: true as const };
}

export async function deleteRoleService(tenantId: string, roleId: string) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) return { ok: false as const, error: "Role not found", status: 404 };

  const memberCount = await prisma.userRole.count({ where: { roleId } });
  if (memberCount > 0) {
    return { ok: false as const, error: "This role is assigned to members and cannot be deleted", status: 409 };
  }

  await prisma.role.delete({ where: { id: roleId } });

  return { ok: true as const };
}
