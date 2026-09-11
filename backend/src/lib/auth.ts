import { type BetterAuthOptions, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { customSession } from "better-auth/plugins";

import { config } from "./config";
import { multiTenant } from "./plugins/multi-tenant";
import { prisma } from "./prisma";
import { getUserPermissions, listTenantsForUser } from "./rbac";

const options = {
  secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: [config.FRONTEND_URL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: { enabled: true },
  plugins: [multiTenant()],
  socialProviders: {
    github: {
      clientId: config.GITHUB_CLIENT_ID,
      clientSecret: config.GITHUB_CLIENT_SECRET,
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const tenants = await listTenantsForUser(session.userId);
          return { data: { activeTenantId: tenants[0]?.id ?? null } };
        },
      },
    },
  },
} satisfies BetterAuthOptions;

type EnrichInput = { user: { id: string }; session: { activeTenantId?: string | null } };

/** Shapes the /get-session response. Holds no authorization logic of its own —
 *  every value comes from this project's rbac.ts. */
export async function enrichSession({ user, session }: EnrichInput) {
  const activeTenantId = session.activeTenantId ?? null;
  const [tenants, permissions] = await Promise.all([
    listTenantsForUser(user.id),
    getUserPermissions(user.id, activeTenantId),
  ]);

  return { user, session, tenants, permissions: [...permissions] };
}

export const auth = betterAuth({
  ...options,
  plugins: [...options.plugins, customSession(enrichSession as never, options)],
});
