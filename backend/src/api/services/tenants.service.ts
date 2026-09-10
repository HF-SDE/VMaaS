import { prisma } from "@/lib/prisma";
import { listTenantsForUser, ROLE_PERMISSIONS, TENANT_ROLES } from "@/lib/rbac";

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
  const ownerRole = await prisma.role.findUnique({ where: { name: TENANT_ROLES.OWNER } });
  if (!ownerRole) {
    return { ok: false as const, error: "Owner role is not seeded", status: 500 };
  }

  const tenant = await prisma.tenant.create({
    data: {
      name,
      userRoles: { create: { userId, roleId: ownerRole.id } },
    },
  });

  return { ok: true as const, tenant };
}

export async function addMemberService(tenantId: string, userId: string, role: string) {
  const roleRecord = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRecord) {
    return { ok: false as const, error: `Unknown role: ${role}`, status: 400 };
  }

  const membership = await prisma.userRole.upsert({
    where: { userId_roleId_tenantId: { userId, roleId: roleRecord.id, tenantId } },
    update: {},
    create: { userId, roleId: roleRecord.id, tenantId },
  });

  return { ok: true as const, membership };
}

export async function removeMemberService(tenantId: string, userId: string) {
  const ownerRole = await prisma.role.findUnique({ where: { name: TENANT_ROLES.OWNER } });
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
