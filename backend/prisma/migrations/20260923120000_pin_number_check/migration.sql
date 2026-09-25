-- Pin.number's "GPIO 0-33" bound has so far lived only as a schema comment and
-- in Zod (slotPinSchema, machines.ts). Zod only guards requests that go
-- through it -- seed.dev.ts bypassed a Zod-enforced bound once already earlier
-- in this same plan (0-based slot numbers), and that was a real bug, not a
-- hypothetical one. A CHECK constraint holds the bound at the one place every
-- writer, present or future, has to go through.
--
-- 0-33 matches slotPinSchema exactly: GPIO 34-39 are input-only on the ESP32
-- and cannot drive a motor, so they are out of range here too.
ALTER TABLE "public"."pin"
  ADD CONSTRAINT "pin_number_range"
  CHECK ("number" BETWEEN 0 AND 33);
