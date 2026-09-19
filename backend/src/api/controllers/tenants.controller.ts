import {
  createRoleSchema,
  getInviteSchema,
  getMembersPageSchema,
  inviteMemberSchema,
  requireTenantId,
  respondToInviteSchema,
  updateMemberRoleSchema,
  updateRoleSchema,
} from "@vmaas/shared/schemas";
import { Request, Response } from "express";
import { z } from "zod";

import {
  createRoleService,
  createTenantService,
  deleteRoleService,
  getInviteService,
  getMembersPageService,
  getMembersService,
  getRolesService,
  getTenantsService,
  inviteMemberService,
  removeMemberService,
  respondToInviteService,
  updateMemberRoleService,
  updateRoleService,
} from "../services/tenants.service";

export async function getTenantsController(req: Request, res: Response) {
  const userId = req.session!.user.id;

  const response = await getTenantsService(userId);

  res.status(200).json(response).end();
}

export async function getMembersController(req: Request, res: Response) {
  const tenantId = req.tenantId!;

  const response = await getMembersService(tenantId);

  res.status(200).json(response).end();
}

/**
 * One page of members, following the products slice: the service answers a
 * `Result` tuple and this switches on the failure's `reason`. The
 * `satisfies never` in the default arm is what makes that exhaustive — adding
 * a reason to the service stops compiling until its status code and wording
 * are decided here.
 */
export async function getMembersPageController(req: Request, res: Response) {
  const tenantId = req.tenantId!;

  // This route has no `validate()` middleware — the query is parsed here.
  const { data, error: parseError } = getMembersPageSchema.safeParse(req.query);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, page] = await getMembersPageService(tenantId, data);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the members" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(page).end();
}

export async function createTenantController(req: Request, res: Response) {
  const { name } = req.body as { name?: string };
  const userId = req.session!.user.id;

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const result = await createTenantService(userId, name.trim());
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(201).json(result.tenant);
}

/**
 * Invites a user to the active tenant.
 *
 * Like the paginated read above, the body is parsed here — this route has no
 * `validate()` middleware — and every failure the service names gets its own
 * status, because the invite dialog tells them apart: a 404 is "no account with
 * that email", a 409 is "already a member", and a 400 is a role that vanished
 * between the page load and the submit.
 */
export async function inviteMemberController(req: Request, res: Response) {
  const { email, role } = inviteMemberSchema.parse(req.body);
  const invitingUserId = req.session!.user.id;

  const [error, invite] = await inviteMemberService(req.tenantId!, email, invitingUserId, role);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "ALREADY_MEMBER":
        return res.status(409).json({ error: error.message }).end();
      case "INVITE_ROLE_NOT_FOUND":
        return res.status(400).json({ error: error.message }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while inviting the member" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(201).json(invite).end();
}

/**
 * One invitation, for the `/invite/[id]` page.
 *
 * Needs only a signed-in user — not tenant membership, which is precisely what
 * the invitation is offering. A 404 here means the id is wrong; an invitation
 * addressed to somebody else still returns 200 with `matchesViewer: false`, so
 * the page can explain the mismatch rather than deny the invitation exists.
 */
export async function getInviteController(req: Request, res: Response) {
  const {
    params: { inviteId },
  } = getInviteSchema.parse(req);
  const { id, email } = req.session!.user;

  const [error, invite] = await getInviteService(inviteId, { id, email });

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "INVITE_NOT_FOUND":
        return res.status(404).json({ error: error.message }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the invitation" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(invite).end();
}

export async function respondToInviteController(req: Request, res: Response) {
  const {
    params: { inviteId },
    body: { status },
  } = respondToInviteSchema.parse(req);
  const { id, email } = req.session!.user;

  const [error, result] = await respondToInviteService(inviteId, { id, email }, status);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "INVITE_NOT_FOUND":
        return res.status(404).json({ error: error.message }).end();
      // Signed in as a different account than the one invited. 403 rather than
      // 404: the invitation is real, it is just not this user's to accept.
      case "INVITE_EMAIL_MISMATCH":
        return res.status(403).json({ error: error.message }).end();
      case "INVITE_EXPIRED":
      case "INVITE_NOT_PENDING":
        return res.status(409).json({ error: error.message }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while responding to the invitation" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res
    .status(200)
    .json({ tenantId: result.tenantId, message: status === "accepted" ? "Invitation accepted" : "Invitation declined" })
    .end();
}

export async function removeMemberController(req: Request, res: Response) {
  const { tenantId } = req;
  const userId = req.params.userId as string;
  console.log("🚀 ~ removeMemberController ~ req:", req.params);
  console.log("🚀 ~ removeMemberController ~ tenantId:", tenantId);

  const result = await removeMemberService(tenantId!, userId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(204).send();
}

export async function updateMemberRoleController(req: Request, res: Response) {
  const data = updateMemberRoleSchema.extend(requireTenantId.shape).parse(req);
  const { tenantId, params, body } = data;

  await updateMemberRoleService(tenantId, params.userId, body.roleName);

  res.status(200).json({ message: "Role updated successfully" });
}

export async function getRolesController(req: Request, res: Response) {
  const { tenantId } = req;

  const roles = await getRolesService(tenantId!);

  res.status(200).json(roles);
}

export async function createRoleController(req: Request, res: Response) {
  const { name, permissions } = createRoleSchema.parse(req.body);

  const result = await createRoleService(req.tenantId!, name, permissions);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(201).json(result.role);
}

export async function updateRoleController(req: Request, res: Response) {
  const { roleId } = req.params as { roleId: string };
  const updates = updateRoleSchema.parse(req.body);

  const result = await updateRoleService(req.tenantId!, roleId, updates);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(200).json({ message: "Role updated" });
}

export async function deleteRoleController(req: Request, res: Response) {
  const { roleId } = req.params as { roleId: string };

  const result = await deleteRoleService(req.tenantId!, roleId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(200).json({ message: "Role deleted" });
}
