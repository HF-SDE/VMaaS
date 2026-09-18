import { z } from "zod/v4";

/**
 * Request-shaped so it can run through `validate()` like every other schema.
 * `days` stays optional — a bare `/map` is a valid request — and the service is
 * what clamps it, so a stale bookmark still renders instead of erroring.
 */
export const getSalesMapSchema = z.object({
  query: z.object({
    days: z.coerce.number().optional(),
  }),
});
