-- The motors are steppers: a vend is a fixed number of STEP pulses, set per
-- machine in the layout editor and published to the device as
-- wiring.motor.stepsPerVend (Motorcontrol config.json schema v2). 6400 is one
-- revolution of a 200-step motor at 1/32 microstepping.
--
-- 1-65535 because the firmware carries it as a u16 and 0 pulses is not a vend.
-- Held by a CHECK as well as by Zod for the same reason pin.number is: the
-- seed writes rows without going through Zod.
ALTER TABLE "public"."machines"
  ADD COLUMN "stepsPerVend" INTEGER NOT NULL DEFAULT 6400;

ALTER TABLE "public"."machines"
  ADD CONSTRAINT "machines_stepsPerVend_range"
  CHECK ("stepsPerVend" BETWEEN 1 AND 65535);
