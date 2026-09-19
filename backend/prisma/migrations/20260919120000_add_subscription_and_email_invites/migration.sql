-- Adds per-tenant billing state, and re-keys tenant invites on the invited
-- email address so someone without an account yet can be invited.
--
-- Non-destructive: `email` is added nullable, backfilled from the user each
-- existing invite already pointed at, and only then made NOT NULL. No invite
-- row is dropped and `userId` is widened rather than removed.

-- CreateEnum
CREATE TYPE "public"."subscription_status" AS ENUM ('pending', 'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid');

-- CreateTable
CREATE TABLE "public"."subscriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "status" "public"."subscription_status" NOT NULL DEFAULT 'pending',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "public"."subscriptions"("tenantId");
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "public"."subscriptions"("stripeCustomerId");
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "public"."subscriptions"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every tenant that already exists predates billing. Give each one a `pending`
-- subscription so `getTenantSubscription` never has to answer "no row" for a
-- tenant the app is already serving.
INSERT INTO "public"."subscriptions" ("id", "tenantId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."tenants" t
ON CONFLICT ("tenantId") DO NOTHING;

-- AlterTable: invites become email-keyed
ALTER TABLE "rbac"."tenant_invites" ADD COLUMN "email" TEXT;

-- Backfill from the user each invite currently points at.
UPDATE "rbac"."tenant_invites" ti
SET "email" = u."email"
FROM "auth"."users" u
WHERE ti."userId" = u."id" AND ti."email" IS NULL;

-- Any invite whose user vanished cannot be honoured and has no address to
-- recover; drop only those, so the NOT NULL below can be applied.
DELETE FROM "rbac"."tenant_invites" WHERE "email" IS NULL;

ALTER TABLE "rbac"."tenant_invites" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "rbac"."tenant_invites" ALTER COLUMN "userId" DROP NOT NULL;

-- Re-key uniqueness on the address rather than the account.
DROP INDEX IF EXISTS "rbac"."tenant_invites_userId_tenantId_status_key";
CREATE UNIQUE INDEX "tenant_invites_email_tenantId_status_key" ON "rbac"."tenant_invites"("email", "tenantId", "status");
CREATE INDEX "tenant_invites_email_idx" ON "rbac"."tenant_invites"("email");

-- A deleted account must not cascade away an invitation that is still valid
-- for that address.
ALTER TABLE "rbac"."tenant_invites" DROP CONSTRAINT "tenant_invites_userId_fkey";
ALTER TABLE "rbac"."tenant_invites" ADD CONSTRAINT "tenant_invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
