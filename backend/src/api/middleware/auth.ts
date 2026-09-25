import { auth } from "@/lib/auth";
import { type PermissionKey, hasPermission, isTenantMember } from "@/lib/rbac";

import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

declare global {
  namespace Express {
    interface Request {
      session?: NonNullable<AuthSession>;
      tenantId?: string;
    }
  }
}

/** Requires a signed-in user. Populates `req.session` with the user + Better Auth session. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.session = session;
  next();
}

/**
 * Resolves the tenant a request acts on and confirms membership. Must run
 * after `requireAuth`. Prefers an explicit `X-Tenant-Id` header / `tenantId`
 * route param over the session's active tenant, so callers can act on a
 * tenant other than the one currently "active" without switching it.
 */
export async function requireTenant(req: Request, res: Response, next: NextFunction) {
  const session = req.session;
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tenantId =
    (req.params.tenantId as string | undefined) ??
    (req.headers["x-tenant-id"] as string | undefined) ??
    session.session.activeTenantId ??
    undefined;

  if (!tenantId) {
    res.status(400).json({ error: "No tenant selected" });
    return;
  }

  if (!(await isTenantMember(session.user.id, tenantId))) {
    res.status(403).json({ error: "Not a member of this tenant" });
    return;
  }

  req.tenantId = tenantId;
  next();
}

/** Must run after `requireAuth` and `requireTenant`. */
export function requirePermission(permission: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = req.session;
    if (!session || !req.tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!(await hasPermission(session.user.id, req.tenantId, permission))) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const session = req.session;
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!session.user.isSuperAdmin) {
    res.status(403).json({ error: "Not a super admin" });
    return;
  }

  next();
}
