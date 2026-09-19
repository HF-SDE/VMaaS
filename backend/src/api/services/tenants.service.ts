import { Prisma, type TenantInvite } from "@/generated/prisma/client";
import { invitationUrl, sendInvitationEmail } from "@/lib/emails";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TENANT_ROLES, createRolesWithPermissions, listTenantsForUser } from "@/lib/rbac";

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
export type InviteNotFoundError = { reason: "INVITE_NOT_FOUND"; message: string };
export type InviteExpiredError = { reason: "INVITE_EXPIRED"; message: string };
export type InviteNotPendingError = { reason: "INVITE_NOT_PENDING"; message: string };
export type InviteEmailMismatchError = { reason: "INVITE_EMAIL_MISMATCH"; message: string };
export type InviteEmailFailedError = { reason: "INVITE_EMAIL_FAILED"; message: string };

/** Thrown only to roll the invite transaction back when the email does not go
 *  out. It never leaves `inviteMemberService`, which turns it back into an
 *  `InviteEmailFailedError`. */
class InviteEmailFailure extends Error {}

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

  // A brand new tenant starts unpaid, which is what sends its owner to the
  // paywall. Created here rather than left to `getTenantSubscription`'s upsert
  // so the row exists from the tenant's first moment and billing has something
  // to attach to.
  await prisma.subscription.create({ data: { tenantId: tenant.id, status: "pending" } });

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
 *
 * The row and its email are written in one transaction: an invitation the
 * invitee never receives is worse than no invitation at all, because the member
 * list would show someone as invited who has no way to accept. If the send
 * fails the upsert is rolled back — including a re-invite, which leaves the
 * previous invitation exactly as it was.
 */
export async function inviteMemberService(
  tenantId: string,
  email: string,
  invitedById: string,
  role: string,
): Promise<
  Result<InviteRoleNotFoundError | AlreadyMemberError | InviteEmailFailedError | UnknownMemberError, TenantInvite>
> {
  // Addresses are compared case-insensitively everywhere, so they are stored
  // folded — otherwise "Kenni@x.dk" and "kenni@x.dk" would be two invitations
  // that the unique index does not recognise as the same.
  const normalisedEmail = email.trim().toLowerCase();

  try {
    const roleRecord = await prisma.role.findFirst({ where: { name: role, tenantId } });
    if (!roleRecord) return err({ reason: "INVITE_ROLE_NOT_FOUND", message: `Unknown role: ${role}.` });

    // An account for this address may not exist yet — that is the point of
    // inviting by email. When one does, it is linked now so the invite shows up
    // for them immediately; when it does not, `userId` stays null and the
    // address is what binds the invite after they sign up.
    const user = await prisma.user.findFirst({ where: { email: { equals: normalisedEmail, mode: "insensitive" } } });

    if (user) {
      const existing = await prisma.userRole.findFirst({ where: { userId: user.id, tenantId } });
      if (existing) return err({ reason: "ALREADY_MEMBER", message: `${email} is already a member of this tenant.` });
    }

    const expireAfterDays = 7;
    const expiresAt = new Date(Date.now() + expireAfterDays * 24 * 60 * 60 * 1000);

    // The email is sent inside the transaction so a failed send takes the row
    // with it. The timeout is raised from Prisma's 5s default because the send
    // is a network call to the mail provider, not just a query.
    const invite = await prisma.$transaction(
      async (tx) => {
        // Re-inviting someone who already has a pending invite is not a failure:
        // the upsert re-points it at the role just picked and extends its life.
        const created = await tx.tenantInvite.upsert({
          where: { email_tenantId_status: { email: normalisedEmail, tenantId, status: "pending" } },
          update: { roleId: roleRecord.id, userId: user?.id ?? null, expiresAt },
          create: {
            email: normalisedEmail,
            userId: user?.id ?? null,
            tenantId,
            roleId: roleRecord.id,
            expiresAt,
            token: crypto.randomUUID(),
            invitedById,
          },
          include: { tenant: true, role: true, invitedBy: { select: { name: true, email: true } } },
        });

        const [sendError] = await sendInvitationEmail(normalisedEmail, {
          tenantName: created.tenant.name,
          roleName: created.role.name,
          invitedBy: created.invitedBy?.name ?? created.invitedBy?.email,
          acceptUrl: invitationUrl(created.id),
          expiresAt: created.expiresAt,
        });

        // A server with no `RESEND_API_KEY` is the local-dev setup, where
        // `sendEmail` logs the invitation link instead of sending it — rolling
        // back there would make inviting impossible without mail credentials.
        // Every other failure is a real one and undoes the invitation.
        if (sendError && sendError.reason !== "EMAIL_NOT_CONFIGURED") {
          throw new InviteEmailFailure(sendError.message);
        }

        return created;
      },
      { timeout: 15_000 },
    );

    return ok(invite);
  } catch (error) {
    if (error instanceof InviteEmailFailure) {
      // TODO: capture sentry error
      console.error(`[tenants.service] inviting ${normalisedEmail} failed to send`, error);

      return err({
        reason: "INVITE_EMAIL_FAILED",
        message: `We could not send the invitation email to ${email}, so no invitation was created. Please try again.`,
      });
    }

    return unknownError("inviting the member", error);
  }
}

/** What the `/invite/[id]` page renders before the user decides. Deliberately
 *  narrow: enough to recognise the invitation, nothing about the tenant beyond
 *  its name. */
export type InviteDetail = {
  id: string;
  email: string;
  tenantId: string;
  tenantName: string;
  roleName: string;
  invitedBy?: string;
  status: TenantInvite["status"];
  expiresAt: Date;
  /** Whether the signed-in user's address matches the invited one. The page
   *  shows a "signed in as someone else" message rather than an accept button
   *  when this is false. */
  matchesViewer: boolean;
  /** Whether the viewer is already a member of the tenant — an invitation that
   *  has been overtaken by events. */
  alreadyMember: boolean;
};

/**
 * Reads one invitation for display.
 *
 * Requires a signed-in viewer and reports whether the invitation is theirs,
 * rather than 404-ing when it is not: the page has to be able to say "this
 * invitation is for another address" instead of pretending it does not exist,
 * which is the one edge case users actually hit.
 */
export async function getInviteService(
  inviteId: string,
  viewer: { id: string; email: string },
): Promise<Result<InviteNotFoundError | UnknownMemberError, InviteDetail>> {
  try {
    const invite = await prisma.tenantInvite.findUnique({
      where: { id: inviteId },
      include: { tenant: true, role: true, invitedBy: { select: { name: true, email: true } } },
    });

    if (!invite) return err({ reason: "INVITE_NOT_FOUND", message: "This invitation does not exist." });

    const alreadyMember =
      (await prisma.userRole.count({ where: { userId: viewer.id, tenantId: invite.tenantId } })) > 0;

    return ok({
      id: invite.id,
      email: invite.email,
      tenantId: invite.tenantId,
      tenantName: invite.tenant.name,
      roleName: invite.role.name,
      invitedBy: invite.invitedBy?.name ?? invite.invitedBy?.email,
      status: invite.status,
      expiresAt: invite.expiresAt,
      matchesViewer: invite.email.toLowerCase() === viewer.email.toLowerCase(),
      alreadyMember,
    });
  } catch (error) {
    return unknownError("loading the invitation", error);
  }
}

/**
 * Accepts or declines an invitation on behalf of the signed-in user.
 *
 * Every precondition is re-checked here, because the page that offered the
 * button is not a security boundary: the address must match the signed-in
 * account, the invite must still be pending, and it must not have expired.
 * Accepting is idempotent about membership — a user who joined by another route
 * in the meantime has their invite closed rather than a duplicate `UserRole`
 * created.
 */
export async function respondToInviteService(
  inviteId: string,
  viewer: { id: string; email: string },
  status: InviteResponses,
): Promise<
  Result<
    InviteNotFoundError | InviteExpiredError | InviteNotPendingError | InviteEmailMismatchError | UnknownMemberError,
    { tenantId: string }
  >
> {
  try {
    const invite = await prisma.tenantInvite.findUnique({ where: { id: inviteId } });

    if (!invite) return err({ reason: "INVITE_NOT_FOUND", message: "This invitation does not exist." });

    if (invite.email.toLowerCase() !== viewer.email.toLowerCase()) {
      return err({
        reason: "INVITE_EMAIL_MISMATCH",
        message: `This invitation was sent to ${invite.email}.`,
      });
    }

    if (invite.status !== "pending") {
      return err({
        reason: "INVITE_NOT_PENDING",
        message:
          invite.status === "accepted"
            ? "This invitation has already been accepted."
            : "This invitation is no longer valid.",
      });
    }

    if (invite.expiresAt < new Date()) {
      // Reflect the expiry in the row so it stops being offered as pending.
      await prisma.tenantInvite.update({ where: { id: invite.id }, data: { status: "expired" } });
      return err({ reason: "INVITE_EXPIRED", message: "This invitation has expired." });
    }

    if (status === "accepted") {
      const alreadyMember = await prisma.userRole.findFirst({
        where: { userId: viewer.id, tenantId: invite.tenantId },
      });

      if (!alreadyMember) {
        await prisma.userRole.create({
          data: { userId: viewer.id, tenantId: invite.tenantId, roleId: invite.roleId },
        });
      }
    }

    await prisma.tenantInvite.update({
      where: { id: invite.id },
      data: {
        status,
        userId: viewer.id,
        acceptedAt: status === "accepted" ? new Date() : null,
      },
    });

    return ok({ tenantId: invite.tenantId });
  } catch (error) {
    return unknownError("responding to the invitation", error);
  }
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
