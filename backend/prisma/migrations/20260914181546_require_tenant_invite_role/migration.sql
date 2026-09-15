/*
  Warnings:

  - Made the column `roleId` on table `tenant_invites` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "rbac"."invitation_status" ADD VALUE 'rejected';

-- DropForeignKey
ALTER TABLE "rbac"."tenant_invites" DROP CONSTRAINT "tenant_invites_roleId_fkey";

-- AlterTable
ALTER TABLE "rbac"."tenant_invites" ALTER COLUMN "roleId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "rbac"."tenant_invites" ADD CONSTRAINT "tenant_invites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "rbac"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
