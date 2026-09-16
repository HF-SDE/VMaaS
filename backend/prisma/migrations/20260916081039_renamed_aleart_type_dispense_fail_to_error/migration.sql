/*
  Warnings:

  - The values [dispenseFail] on the enum `alert_type` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "alert_type_new" AS ENUM ('tamper', 'offline', 'error');
ALTER TABLE "security_alerts" ALTER COLUMN "type" TYPE "alert_type_new" USING ("type"::text::"alert_type_new");
ALTER TYPE "alert_type" RENAME TO "alert_type_old";
ALTER TYPE "alert_type_new" RENAME TO "alert_type";
DROP TYPE "public"."alert_type_old";
COMMIT;
