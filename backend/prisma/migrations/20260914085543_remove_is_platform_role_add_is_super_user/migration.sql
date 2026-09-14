/*
  Warnings:

  - You are about to drop the column `isPlatformRole` on the `roles` table. All the data in the column will be lost.
  - Added the required column `tenantId` to the `roles` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "auth"."users" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "rbac"."roles" DROP COLUMN "isPlatformRole",
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AddForeignKey
ALTER TABLE "rbac"."roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "rbac"."roles_name_key";
