-- Records that a free trial has been handed out, so it cannot be handed out
-- twice. The two unique indexes are the whole feature: one trial per user
-- however many organizations they create, one per organization however many
-- owners it passes through.

-- CreateTable
CREATE TABLE "public"."trial_grants" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trial_grants_userId_key" ON "public"."trial_grants"("userId");
CREATE UNIQUE INDEX "trial_grants_tenantId_key" ON "public"."trial_grants"("tenantId");

-- AddForeignKey
ALTER TABLE "public"."trial_grants" ADD CONSTRAINT "trial_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."trial_grants" ADD CONSTRAINT "trial_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Any tenant that is already past `pending` got there by paying, before trials
-- existed. Claim their trial retroactively so enabling this feature does not
-- hand a free month to every customer who already subscribed.
INSERT INTO "public"."trial_grants" ("id", "userId", "tenantId", "createdAt")
SELECT DISTINCT ON (s."tenantId") gen_random_uuid(), ur."userId", s."tenantId", CURRENT_TIMESTAMP
FROM "public"."subscriptions" s
JOIN "rbac"."user_roles" ur ON ur."tenantId" = s."tenantId"
JOIN "rbac"."roles" r ON r."id" = ur."roleId" AND r."name" = 'owner'
WHERE s."status" <> 'pending'
ORDER BY s."tenantId", ur."createdAt"
ON CONFLICT DO NOTHING;
