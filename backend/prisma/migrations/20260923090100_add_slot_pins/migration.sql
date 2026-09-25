-- The pin table has existed empty since the schema was first drawn. It becomes
-- the motor wiring: which GPIO drives which slot.
--
-- machineId is denormalised from the slot so (machineId, number) can be unique.
-- The firmware's pin_for() returns the first slot matching a GPIO, so two slots
-- claiming the same pin would silently drive the wrong motor -- a constraint the
-- database can hold, and should.
--
-- No data step: the table is empty in every environment.
ALTER TABLE "public"."pin" ADD COLUMN "machineId" UUID NOT NULL;
ALTER TABLE "public"."pin" ADD COLUMN "slotId" UUID NOT NULL;

ALTER TABLE "public"."pin"
  ADD CONSTRAINT "pin_slotId_fkey"
  FOREIGN KEY ("slotId") REFERENCES "public"."slots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "pin_machineId_number_key" ON "public"."pin"("machineId", "number");
CREATE INDEX "pin_slotId_idx" ON "public"."pin"("slotId");
