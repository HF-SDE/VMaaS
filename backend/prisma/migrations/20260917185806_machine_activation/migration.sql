-- CreateEnum
CREATE TYPE "machine_registration_status" AS ENUM ('unregistered', 'claimed', 'permanent_locked');

-- CreateEnum
CREATE TYPE "machine_command_status" AS ENUM ('pending', 'sent', 'completed', 'failed', 'expired');

-- AlterTable
ALTER TABLE "machines" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "registrationStatus" "machine_registration_status" NOT NULL DEFAULT 'unregistered',
ADD COLUMN     "serialNumber" TEXT,
ALTER COLUMN "siteId" DROP NOT NULL;

-- Backfill existing rows before the column can be made NOT NULL / unique.
UPDATE "machines" SET "serialNumber" = 'LEGACY-' || "id" WHERE "serialNumber" IS NULL;

ALTER TABLE "machines" ALTER COLUMN "serialNumber" SET NOT NULL;

-- Existing machines are already in service, so mark them locked rather than
-- leaving them claimable.
UPDATE "machines" SET "registrationStatus" = 'permanent_locked' WHERE "tenantId" IS NOT NULL;
UPDATE "machines" SET "registrationStatus" = 'claimed' WHERE "tenantId" IS NULL;

-- CreateTable
CREATE TABLE "machine_activations" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_certificates" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_configurations" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_commands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "commandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "machine_command_status" NOT NULL DEFAULT 'pending',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "machine_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "machineId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "eventId" TEXT,
    "sequenceNumber" BIGINT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "machine_activations_machineId_idx" ON "machine_activations"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "machine_certificates_serial_key" ON "machine_certificates"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "machine_certificates_fingerprint_key" ON "machine_certificates"("fingerprint");

-- CreateIndex
CREATE INDEX "machine_certificates_machineId_idx" ON "machine_certificates"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "machine_configurations_machineId_version_key" ON "machine_configurations"("machineId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "machine_commands_commandId_key" ON "machine_commands"("commandId");

-- CreateIndex
CREATE INDEX "machine_commands_machineId_status_idx" ON "machine_commands"("machineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "machine_events_eventId_key" ON "machine_events"("eventId");

-- CreateIndex
CREATE INDEX "machine_events_machineId_occurredAt_idx" ON "machine_events"("machineId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "machines_serialNumber_key" ON "machines"("serialNumber");

-- AddForeignKey
ALTER TABLE "machine_activations" ADD CONSTRAINT "machine_activations_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_certificates" ADD CONSTRAINT "machine_certificates_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_configurations" ADD CONSTRAINT "machine_configurations_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_commands" ADD CONSTRAINT "machine_commands_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_events" ADD CONSTRAINT "machine_events_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

