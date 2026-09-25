-- Slot numbers become 1-based, matching the device. prices.h states "Slots are
-- 1-based" and prices.cpp discards slot 0, while this column started at 0 --
-- so device.service.ts, which matches a cash sale with `slotNumber: cash.slot`,
-- has been recording sales from physical slot 1 against the layout's second
-- slot. Making the column 1-based removes the mismatch rather than converting
-- around it.
--
-- Two statements, not one: `SET slot_number = slot_number + 1` is checked per
-- row against the (machineId, slotNumber) unique index and collides with the
-- row it is about to move onto. Going via negatives is the same detour
-- saveSlotLayoutService already makes for the same reason.
UPDATE "public"."slots" SET "slotNumber" = -("slotNumber" + 1);
UPDATE "public"."slots" SET "slotNumber" = -"slotNumber";
