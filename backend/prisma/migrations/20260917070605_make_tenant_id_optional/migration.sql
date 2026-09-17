-- DropForeignKey
ALTER TABLE "machines" DROP CONSTRAINT "machines_tenantId_fkey";

-- AlterTable
ALTER TABLE "machines" ALTER COLUMN "tenantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "slots" ALTER COLUMN "productId" DROP NOT NULL;