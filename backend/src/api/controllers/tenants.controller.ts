import { Request, Response } from "express";
import { z } from "zod/v4-mini";

import {
  ASSIGNABLE_ROLES,
  addMemberService,
  createTenantService,
  getMembersService,
  getRolesService,
  getTenantsService,
  removeMemberService,
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

export async function addMemberController(req: Request, res: Response) {
  const { userId, role } = req.body as { userId?: string; role?: string };
  if (!userId || !role || !ASSIGNABLE_ROLES.includes(role)) {
    res
      .status(400)
      .json({ error: `userId and role are required (role must be one of: ${ASSIGNABLE_ROLES.join(", ")})` });
    return;
  }

  const result = await addMemberService(req.tenantId!, userId, role);

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(201).json(result.membership);
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

export function getRolesController(_req: Request, res: Response) {
  res.json(getRolesService());
}
