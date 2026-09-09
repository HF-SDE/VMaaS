import { prisma } from "./prisma";
import type { TenantModel } from "../generated/prisma/models";

/**
 * Grantable capabilities, namespaced as "resource:action".
 * Kept as the single source of truth for both the seed script and
 * runtime permission checks.
 */
export const PERMISSIONS = {
  TENANT_MANAGE: "tenant:manage",
  TENANT_VIEW: "tenant:view",
  USER_MANAGE: "user:manage",
  USER_VIEW: "user:view",
  MACHINE_READ: "machine:read",
  MACHINE_WRITE: "machine:write",
  PRODUCT_READ: "product:read",
  PRODUCT_WRITE: "product:write",
  SLOT_MANAGE: "slot:manage",
  SALE_READ: "sale:read",
  SALE_REFUND: "sale:refund",
  ALERT_READ: "alert:read",
  ALERT_RESOLVE: "alert:resolve",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PLATFORM_ROLE = "superadmin";

export const TENANT_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  OPERATOR: "operator",
  VIEWER: "viewer",
} as const;

/** Baseline role -> permission mapping used by the seed script. */
export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  [PLATFORM_ROLE]: Object.values(PERMISSIONS),
  [TENANT_ROLES.OWNER]: Object.values(PERMISSIONS),
  [TENANT_ROLES.ADMIN]: Object.values(PERMISSIONS).filter(
    (key) => key !== PERMISSIONS.TENANT_MANAGE,
  ),
  [TENANT_ROLES.OPERATOR]: [
    PERMISSIONS.TENANT_VIEW,
    PERMISSIONS.MACHINE_READ,
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.SLOT_MANAGE,
    PERMISSIONS.SALE_READ,
    PERMISSIONS.ALERT_READ,
    PERMISSIONS.ALERT_RESOLVE,
  ],
  [TENANT_ROLES.VIEWER]: [
    PERMISSIONS.TENANT_VIEW,
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.MACHINE_READ,
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.SALE_READ,
    PERMISSIONS.ALERT_READ,
  ],
};

/** All permission keys granted to `userId`, scoped to `tenantId` plus any platform-wide roles. */
export async function getUserPermissions(
  userId: string,
  tenantId: string | null,
): Promise<Set<PermissionKey>> {
  const userRoles = await prisma.userRole.findMany({
    where: tenantId
      ? { userId, OR: [{ role: { isPlatformRole: true } }, { tenantId }] }
      : { userId, role: { isPlatformRole: true } },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });

  const permissions = new Set<PermissionKey>();
  for (const userRole of userRoles) {
    for (const rolePermission of userRole.role.rolePermissions) {
      permissions.add(rolePermission.permission.key as PermissionKey);
    }
  }
  return permissions;
}

export async function hasPermission(
  userId: string,
  tenantId: string | null,
  permission: PermissionKey,
): Promise<boolean> {
  const permissions = await getUserPermissions(userId, tenantId);
  return permissions.has(permission);
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const count = await prisma.userRole.count({
    where: { userId, role: { isPlatformRole: true } },
  });
  return count > 0;
}

/** Whether `userId` may act within `tenantId` — either via direct membership or a platform role. */
export async function isTenantMember(userId: string, tenantId: string): Promise<boolean> {
  if (await isPlatformAdmin(userId)) return true;
  const count = await prisma.userRole.count({ where: { userId, tenantId } });
  return count > 0;
}

/** Tenants `userId` belongs to. Platform admins are treated as members of every tenant. */
export async function listTenantsForUser(userId: string): Promise<TenantModel[]> {
  if (await isPlatformAdmin(userId)) {
    return prisma.tenant.findMany({ orderBy: { name: "asc" } });
  }
  const userRoles = await prisma.userRole.findMany({
    where: { userId, tenantId: { not: null } },
    include: { tenant: true },
    distinct: ["tenantId"],
  });
  return userRoles.map((userRole) => userRole.tenant!).filter(Boolean);
}
