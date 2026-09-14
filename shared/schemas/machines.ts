import { z } from "zod/v4";

/**
 * `Machine.location` is `String?` in Prisma — a machine can be registered before
 * it has been placed — so a location is never required. A form sends `""` for an
 * empty field rather than omitting it, which is why blank is normalised here
 * instead of failing `min(1)`: the user leaving the field alone and a client
 * omitting the key have to mean the same thing.
 *
 * `status` is deliberately absent from both write schemas. It is reported by the
 * machine's firmware and defaults to `online`, so there is nothing for an admin
 * to send; the services do not accept it either.
 */
export const createMachineSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, { message: "name is required" }),
    location: z
      .string()
      .trim()
      .optional()
      .transform((location) => location || undefined),
  }),
});

/** Shared by every `/:id` route, so a malformed id is a 400 rather than a
 *  database error on a value that could never have matched. The controllers
 *  parse it again to read the id as a typed string. */
export const machineIdParamsSchema = z.object({
  params: z.object({
    id: z.uuid({ message: "id must be a uuid" }),
  }),
});

/**
 * Both fields are optional so the form can send only what changed, but an
 * entirely empty body is rejected — it would be a write that silently does
 * nothing while answering 200.
 *
 * Blank maps to `null` here, not to `undefined` as it does on create: on an
 * update the two are different intents. `undefined` means "leave the location
 * alone", while a user who emptied the field means "clear it", and only `null`
 * reaches the nullable column as a clear.
 */
export const updateMachineSchema = z.object({
  params: machineIdParamsSchema.shape.params,
  body: z
    .object({
      name: z.string().trim().min(1, { message: "name is required" }).optional(),
      location: z
        .string()
        .trim()
        .nullable()
        .optional()
        .transform((location) => (location === undefined ? undefined : location || null)),
    })
    .refine((body) => body.name !== undefined || body.location !== undefined, {
      message: "at least one of name or location is required",
    }),
});

export const getMachinesPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});
