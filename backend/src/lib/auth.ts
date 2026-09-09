import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { multiTenant } from "./plugins/multi-tenant";
import { prisma } from "./prisma";
import { listTenantsForUser } from "./rbac";

export const auth = betterAuth({
  basePath: "/auth",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: { enabled: true },
  plugins: [multiTenant()],
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
});
