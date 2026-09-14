-- CreateEnum
CREATE TYPE "rbac"."invitation_status" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "rbac"."tenant_invites" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roleId" UUID,
    "invitedById" UUID NOT NULL,
    "status" "rbac"."invitation_status" NOT NULL DEFAULT 'pending',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invites_token_key" ON "rbac"."tenant_invites"("token");

-- CreateIndex
CREATE INDEX "tenant_invites_tenantId_idx" ON "rbac"."tenant_invites"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_invites_userId_idx" ON "rbac"."tenant_invites"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invites_userId_tenantId_status_key" ON "rbac"."tenant_invites"("userId", "tenantId", "status");

-- AddForeignKey
ALTER TABLE "rbac"."tenant_invites" ADD CONSTRAINT "tenant_invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rbac"."tenant_invites" ADD CONSTRAINT "tenant_invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rbac"."tenant_invites" ADD CONSTRAINT "tenant_invites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "rbac"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rbac"."tenant_invites" ADD CONSTRAINT "tenant_invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
