import { z } from "zod/v4";

/** The wording a form shows when the site picker was left empty: a blank picker
 *  sends `""`, which fails the uuid check, so this is what the user reads. */
const SITE_ID_MESSAGE = { message: "site is required" };

/**
 * `Machine.siteId` is required and `onDelete: Restrict` — a machine stands at a
 * site, so there is no "not placed yet" state to model and no blank to normalise
 * away. That the site belongs to the caller's tenant is not something a schema
 * can tell; the service checks it before the write.
 *
 * `status` is deliberately absent from both write schemas. It is reported by the
 * machine's firmware and defaults to `online`, so there is nothing for an admin
 * to send; the services do not accept it either.
 */
export const createMachineSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, { message: "name is required" }),
    siteId: z.uuid(SITE_ID_MESSAGE),
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
 * `siteId` takes no `null`, unlike the nullable columns on `Site`: moving a
 * machine means naming another site, never clearing the one it stands at.
 */
export const updateMachineSchema = z.object({
  params: machineIdParamsSchema.shape.params,
  body: z
    .object({
      name: z.string().trim().min(1, { message: "name is required" }).optional(),
      siteId: z.uuid(SITE_ID_MESSAGE).optional(),
    })
    .refine((body) => body.name !== undefined || body.siteId !== undefined, {
      message: "at least one of name or site is required",
    }),
});

/**
 * `GET /api/machines/simple-search`, the machine picker's endpoint.
 *
 * `search` is required and one character is enough — the picker searches from
 * the first keystroke — while `limit` is only coerced here and clamped in the
 * service, so a hand-edited `limit=9999` still answers a short list.
 */
export const simpleMachineSearchSchema = z.object({
  search: z.string().trim().min(1, { message: "search is required" }),
  limit: z.coerce.number().optional(),
});

export const getMachinesPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});
