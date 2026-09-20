import { type BetterAuthOptions, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { customSession } from "better-auth/plugins";

import { getTenantSubscription } from "../api/services/subscriptions.service";
import { config } from "./config";
import { multiTenant } from "./plugins/multi-tenant";
import { prisma } from "./prisma";
import { getUserInvites, getUserPermissions, isTenantOwner, listTenantsForUser } from "./rbac";

const github = {
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: config.GITHUB_CLIENT_SECRET,
};

const socialProviders: BetterAuthOptions["socialProviders"] = {};

if (github.clientId && github.clientSecret) {
  socialProviders.github = {
    clientId: github.clientId,
    clientSecret: github.clientSecret,
  };
}

const options = {
  secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: config.FRONTEND_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: { enabled: true },
  plugins: [multiTenant()],
  socialProviders,
  user: { additionalFields: { isSuperAdmin: { type: "boolean", defaultValue: false, input: false } } },
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

type EnrichInput = { user: { id: string; email: string }; session: { activeTenantId?: string | null } };

/** Shapes the /get-session response. Holds no authorization logic of its own —
 *  every value comes from this project's rbac.ts and subscriptions.service.ts. */
export async function enrichSession({ user, session }: EnrichInput) {
  const [tenants, tenantInvites] = await Promise.all([listTenantsForUser(user.id), getUserInvites(user.email)]);

  // The session's active tenant can outlive the membership that justified it —
  // the user was removed from the tenant, or the tenant was deleted, while they
  // stayed signed in. Reporting it anyway would leave the frontend routing into
  // a tenant the backend then refuses every request for, so it is dropped here
  // and the user falls back to onboarding or the selector.
  const claimedTenantId = session.activeTenantId ?? null;
  const activeTenantId = claimedTenantId && tenants.some((tenant) => tenant.id === claimedTenantId)
    ? claimedTenantId
    : null;

  const [permissions, subscriptionResult] = await Promise.all([
    getUserPermissions(user.id, activeTenantId),
    activeTenantId ? getTenantSubscription(activeTenantId) : Promise.resolve(null),
  ]);

  // A subscription lookup that failed must not read as "no subscription", which
  // would silently paywall a paying tenant. `null` says "unknown"; the frontend
  // treats that as an error rather than as a billing state.
  const subscription =
    subscriptionResult && !subscriptionResult[0]
      ? {
          status: subscriptionResult[1].status,
          trialEndsAt: subscriptionResult[1].trialEndsAt,
          currentPeriodEnd: subscriptionResult[1].currentPeriodEnd,
          cancelAtPeriodEnd: subscriptionResult[1].cancelAtPeriodEnd,
        }
      : null;

  const isOwner = activeTenantId ? await isTenantOwner(user.id, activeTenantId) : false;

  return {
    user,
    session: { ...session, activeTenantId },
    tenants,
    tenantInvites,
    permissions: [...permissions],
    subscription,
    isOwner,
  };
}

export const auth = betterAuth({
  ...options,
  plugins: [...options.plugins, customSession(enrichSession as never, options)],
});
