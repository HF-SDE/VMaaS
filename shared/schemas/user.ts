import { z } from "zod/v4";

/** Shaped `{ body }` so `validate()` actually parses it — a bare body schema
 *  silently strips to `{}` there, leaving the raw body on the request. */
export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(100),
  }),
});
