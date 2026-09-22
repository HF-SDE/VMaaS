-- Which plan a tenant is billed for. Nullable and with no default: an existing
-- row predates the column and its plan is unknown until the next webhook for
-- that subscription writes one, which is the truthful state to start from.

-- CreateEnum
CREATE TYPE "public"."subscription_plan" AS ENUM ('monthly', 'yearly');

-- AlterTable
ALTER TABLE "public"."subscriptions" ADD COLUMN "plan" "public"."subscription_plan";
