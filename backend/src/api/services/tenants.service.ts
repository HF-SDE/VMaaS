import { Prisma, type TenantInvite } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TENANT_ROLES, ROLE_PERMISSIONS, createRolesWithPermissions, listTenantsForUser } from "@/lib/rbac";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";
import { type GetMembersParams, MEMBER_SORT_FIELDS, type MemberSortField } from "@vmaas/shared/types/member";
import { InviteResponses } from "@vmaas/shared/types/tenants";
import { APIError } from "better-auth";

export const DEFAULT_ROLES = Object.values(DEFAULT_TENANT_ROLES) as string[];

export async function getTenantsService(userId: string) {
  return listTenantsForUser(userId);
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT_BY: MemberSortField = "name";
const DEFAULT_SORT_ORDER = "asc" as const;

/**
 * Shared by the list and the page so both answer rows of the same shape — the
 * frontend types its table on `MembersResponse`, which is derived from
 * `getMembersService`, and a second `include` here would let the two drift.
 * A user's email is part of the row because it is what the UI searches on.
 */
const MEMBER_INCLUDE = {
  user: { select: { id: true, name: true, email: true } },
  role: true,
} satisfies Prisma.UserRoleInclude;

/** One membership, not one user: a user holding two roles in the same tenant is
 *  two rows, which is what `UserRole`'s `@@unique([userId, roleId, tenantId])`
 *  allows. */
export type MemberListItem = Prisma.UserRoleGetPayload<{ include: typeof MEMBER_INCLUDE }>;

/**
 * Only the paginated read answers a `Result` tuple so far — the rest of this
 * file still throws `APIError`. New work here follows the products slice
 * (`products.service.ts`), so the reasons a caller has to handle are named
 * values its controller switches on exhaustively.
 */
export type UnknownMemberError = { reason: "UNKNOWN_ERROR"; message: string };
export type InviteRoleNotFoundError = { reason: "INVITE_ROLE_NOT_FOUND"; message: string };
export type InviteUserNotFoundError = { reason: "INVITE_USER_NOT_FOUND"; message: string };
export type AlreadyMemberError = { reason: "ALREADY_MEMBER"; message: string };

function isSortField(value: string): value is MemberSortField {
  return (MEMBER_SORT_FIELDS as readonly string[]).includes(value);
}

/** The catch-all for a throw no service anticipated. The thrown value never
 *  reaches the response; it is logged here so the caller only has to render one
 *  generic failure. */
function unknownError(action: string, cause: unknown): Result<UnknownMemberError, never> {
  // TODO: capture sentry error
  console.error(`[tenants.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action}.`,
  });
}

export async function getMembersService(tenantId: string) {
  const members = await prisma.userRole.findMany({
    where: { tenantId },
    include: MEMBER_INCLUDE,
  });

  return members;
}

/**
 * One page of a tenant's members, with optional search and sorting.
 *
 * Every parameter is clamped or whitelisted rather than rejected, so a stale
 * bookmark (`?page=9999&sortBy=bogus`) still renders instead of erroring.
 *
 * The tenant comes from `req.tenantId`, never from the query, so this can only
 * ever read the memberships of the tenant the caller was verified against.
 */
export async function getMembersPageService(
  tenantId: string,
  params: GetMembersParams = {},
): Promise<Result<UnknownMemberError, GetPaginatedResult<MemberListItem>>> {
  const page = Math.max(0, Math.trunc(params.page ?? 0));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE)));
  const sortBy = params.sortBy && isSortField(params.sortBy) ? params.sortBy : DEFAULT_SORT_BY;
  const sortOrder = params.sortOrder === "desc" ? "desc" : DEFAULT_SORT_ORDER;
  const search = params.search?.trim();

  // A member is looked up by who they are, so the search spans both of the
  // columns that name them — the role is a filter's job, not a search's.
  const where: Prisma.UserRoleWhereInput = {
    tenantId,
    ...(search
      ? {
          OR: [
            { user: { name: { contains: search, mode: "insensitive" as const } } },
            { user: { email: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  // `createdAt` is the only sort that lands on `user_roles` itself; the other
  // three reach through a relation. Annotated rather than inferred: the union
  // of the branches widens `sortOrder` back to `string`, which Prisma's
  // `SortOrder` will not take.
  const orderBy: Prisma.UserRoleOrderByWithRelationInput =
    sortBy === "name"
      ? { user: { name: sortOrder } }
      : sortBy === "email"
        ? { user: { email: sortOrder } }
        : sortBy === "role"
          ? { role: { name: sortOrder } }
          : { createdAt: sortOrder };

  try {
    const [members, totalCount] = await prisma.$transaction([
      prisma.userRole.findMany({
        where,
        include: MEMBER_INCLUDE,
        orderBy,
        skip: page * pageSize,
        take: pageSize,
      }),
      prisma.userRole.count({ where }),
    ]);

    return ok({
      data: members,
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
      totalCount,
    });
  } catch (error) {
    return unknownError("listing the members", error);
  }
}

export async function createTenantService(userId: string, name: string) {
  const tenant = await prisma.tenant.create({ data: { name } });

  await createRolesWithPermissions(tenant.id, DEFAULT_ROLES);

  const ownerRole = await prisma.role.findFirst({ where: { name: DEFAULT_TENANT_ROLES.OWNER, tenantId: tenant.id } });
  if (!ownerRole) return { ok: false as const, error: "Owner role is not seeded", status: 500 };

  await prisma.userRole.create({ data: { userId, roleId: ownerRole.id, tenantId: tenant.id } });

  return { ok: true as const, tenant };
}

/**
 * Invite a user to the tenant.
 *
 * Every way this can fail is a named reason rather than a throw, because the
 * dialog that calls it words each one differently — "no account with that
 * email" is the one a user actually hits, and it has to be tellable apart from
 * a role that went missing between the page load and the submit.
 *
 * Re-inviting someone who already has a pending invite is not a failure: the
 * upsert re-points it at the role just picked and the invite stands.
 */
export async function inviteMemberService(
  tenantId: string,
  email: string,
  invitedById: string,
  role: string,
): Promise<
  Result<InviteRoleNotFoundError | InviteUserNotFoundError | AlreadyMemberError | UnknownMemberError, TenantInvite>
> {
  try {
    const roleRecord = await prisma.role.findFirst({ where: { name: role, tenantId } });
    if (!roleRecord) return err({ reason: "INVITE_ROLE_NOT_FOUND", message: `Unknown role: ${role}.` });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return err({ reason: "INVITE_USER_NOT_FOUND", message: `No user with the email ${email}.` });

    const existing = await prisma.userRole.findFirst({ where: { userId: user.id, tenantId } });
    if (existing) return err({ reason: "ALREADY_MEMBER", message: `${email} is already a member of this tenant.` });

    const expireAfterDays = 7;
    const expiresAt = new Date(Date.now() + expireAfterDays * 24 * 60 * 60 * 1000);

    return ok(
      await prisma.tenantInvite.upsert({
        where: { userId_tenantId_status: { userId: user.id, tenantId, status: "pending" } },
        update: { roleId: roleRecord.id },
        create: {
          userId: user.id,
          tenantId,
          roleId: roleRecord.id,
          expiresAt,
          token: crypto.randomUUID(),
          invitedById,
        },
      }),
    );
  } catch (error) {
    return unknownError("inviting the member", error);
  }
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

export async function updateMemberRoleService(tenantId: string, userId: string, roleName: string) {
  const role = await prisma.role.findFirst({ where: { name: roleName, tenantId } });
  if (!role) throw new APIError("BAD_REQUEST", { message: `Unknown role: ${roleName}` });

  await prisma.userRole.updateMany({ where: { userId, tenantId }, data: { roleId: role.id } });

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
