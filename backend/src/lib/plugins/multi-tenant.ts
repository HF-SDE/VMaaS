import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";
import { isTenantMember, listTenantsForUser } from "../rbac";

/**
 * Adds an `activeTenantId` column to the session table and two endpoints
 * (mounted under the Better Auth handler at `/api/auth/tenant/*`) to read and
 * switch it, mirroring how Better Auth's own `organization` plugin manages
 * `activeOrganizationId` — but scoped to this app's existing Tenant/Role/
 * Permission/UserRole tables instead of introducing a parallel org model.
 */
export const multiTenant = () =>
  ({
    id: "multi-tenant",
    schema: {
      session: {
        fields: {
          activeTenantId: {
            type: "string",
            required: false,
            input: false,
          },
        },
      },
    },
    endpoints: {
      switchTenant: createAuthEndpoint(
        "/tenant/switch",
        {
          method: "POST",
          body: z.object({ tenantId: z.string().nullable() }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const { tenantId } = ctx.body;
          const userId = ctx.context.session.user.id;

          if (tenantId !== null && !(await isTenantMember(userId, tenantId))) {
            throw new APIError("FORBIDDEN", {
              message: "You are not a member of this tenant.",
            });
          }

          const session = await ctx.context.internalAdapter.updateSession(
            ctx.context.session.session.token,
            { activeTenantId: tenantId },
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to update session" });
          }

          await setSessionCookie(ctx, { session, user: ctx.context.session.user });
          return ctx.json({ activeTenantId: tenantId });
        },
      ),
      myTenants: createAuthEndpoint(
        "/tenant/mine",
        {
          method: "GET",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const tenants = await listTenantsForUser(ctx.context.session.user.id);
          return ctx.json({ tenants });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
