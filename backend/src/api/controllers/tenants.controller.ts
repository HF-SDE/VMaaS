import { createRoleSchema, inviteMemberSchema, respondToInviteSchema, updateRoleSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";
import { z } from "zod/v4-mini";

import {
  DEFAULT_ROLES,
  createRoleService,
  createTenantService,
  deleteRoleService,
  getMembersService,
  getRolesService,
  getTenantsService,
  inviteMemberService,
  removeMemberService,
  respondToInviteService,
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

export async function inviteMemberController(req: Request, res: Response) {
  const { email, role } = inviteMemberSchema.parse(req.body);
  const invitingUserId = req.session!.user.id;

  const result = await inviteMemberService(req.tenantId!, email, invitingUserId, role);

  res.status(201).json(result.membership);
}

export async function respondToInviteController(req: Request, res: Response) {
  const {
    params: { token },
    body: { status },
  } = respondToInviteSchema.parse(req);
  const userId = req.session!.user.id;

  const result = await respondToInviteService(token, userId, status);
  if (!result.ok) {
    res.status(500).json({ error: "An unknown error occurred!" });
    return;
  }

  res.status(200).json({ message: "Invite accepted successfully" });
}

export async function removeMemberController(req: Request, res: Response) {
  const { userId, tenantId } = req.params as { userId: string; tenantId: string };

  const result = await removeMemberService(tenantId, userId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(204).send();
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
