-- Makes `never_seen` the resting state of a machine nothing has been heard
-- from, and corrects the rows that the previous `@default(online)` mislabelled.
--
-- `lastConnectionEventAt IS NULL` is the whole rule, and it is exactly what the
-- column means: connection.service.ts sets it on EVERY accepted broker event,
-- including a no-op one, so a null there cannot mean anything other than "no
-- event has ever landed for this machine". Rows that have a clock keep the
-- status their last real event gave them.
ALTER TABLE "public"."machines" ALTER COLUMN "status" SET DEFAULT 'never_seen';

UPDATE "public"."machines"
   SET "status" = 'never_seen'
 WHERE "lastConnectionEventAt" IS NULL;
