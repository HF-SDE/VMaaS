/*
  Warnings:

  - You are about to drop the column `slotId` on the `sales` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_machineId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_slotId_fkey";

-- DropIndex
DROP INDEX "sales_slotId_idx";

-- AlterTable
ALTER TABLE "sales" DROP COLUMN "slotId";

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
