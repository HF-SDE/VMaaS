import { prisma } from "@/lib/prisma";
import { ROLE_PERMISSIONS, TENANT_ROLES, createRolesWithPermissions, listTenantsForUser } from "@/lib/rbac";

import { APIError } from "better-auth";

export const ASSIGNABLE_ROLES = Object.values(TENANT_ROLES) as string[];

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

  await createRolesWithPermissions(tenant.id, ASSIGNABLE_ROLES);

  const ownerRole = await prisma.role.findFirst({ where: { name: TENANT_ROLES.OWNER, tenantId: tenant.id } });
  if (!ownerRole) return { ok: false as const, error: "Owner role is not seeded", status: 500 };

  await prisma.userRole.create({ data: { userId, roleId: ownerRole.id, tenantId: tenant.id } });

  return { ok: true as const, tenant };
}

export async function addMemberService(tenantId: string, userId: string, role: string) {
  const roleRecord = await prisma.role.findFirst({ where: { name: role, tenantId } });
  if (!roleRecord) {
    throw new APIError("BAD_REQUEST", { message: `Unknown role: ${role}` });
  }

  const membership = await prisma.userRole.upsert({
    where: { userId_roleId_tenantId: { userId, roleId: roleRecord.id, tenantId } },
    update: {},
    create: { userId, roleId: roleRecord.id, tenantId },
  });

  return { ok: true as const, membership };
}

export async function removeMemberService(tenantId: string, userId: string) {
  const ownerRole = await prisma.role.findFirst({ where: { name: TENANT_ROLES.OWNER, tenantId } });
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

export function getRolesService() {
  return ASSIGNABLE_ROLES.map((name) => ({ name, permissions: ROLE_PERMISSIONS[name] ?? [] }));
}
