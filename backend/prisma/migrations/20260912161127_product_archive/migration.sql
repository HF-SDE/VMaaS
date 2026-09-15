/*
  Warnings:

  - Added the required column `beginX` to the `slots` table without a default value. This is not possible if the table is not empty.
  - Added the required column `beginY` to the `slots` table without a default value. This is not possible if the table is not empty.
  - Added the required column `endX` to the `slots` table without a default value. This is not possible if the table is not empty.
  - Added the required column `endY` to the `slots` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "slots" ADD COLUMN     "beginX" INTEGER NOT NULL,
ADD COLUMN     "beginY" INTEGER NOT NULL,
ADD COLUMN     "endX" INTEGER NOT NULL,
ADD COLUMN     "endY" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "pin" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "pin_pkey" PRIMARY KEY ("id")
);
