import { z } from "zod/v4";

import { findFloatingSlots, hasOverlappingSlots } from "../lib/slot-layout";

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
 *
 * Request-shaped so it can run through `validate()`, which is what makes the
 * missing-`search` case a 400 rather than a throw out of the controller.
 */
export const simpleMachineSearchSchema = z.object({
  query: z.object({
    search: z.string().trim().min(1, { message: "search is required" }),
    limit: z.coerce.number().optional(),
  }),
});

/**
 * Request-shaped so it can run through `validate()` like every other machine
 * schema. Every field stays optional — a bare `/paginated` is a valid request —
 * and the service is what clamps and whitelists the values it gets.
 */
export const getMachinesPageSchema = z.object({
  query: z.object({
    page: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    search: z.string().optional(),
  }),
});

/** A grid coordinate: 0-based, so the bottom row and the left column are 0 */
const coordinate = z.number().int().min(0);

const slotLayoutSlotSchema = z
  .object({
    id: z.uuid({ message: "slot id must be a uuid" }).optional(),
    slotNumber: z.number().int().min(0),
    beginX: coordinate,
    endX: coordinate,
    beginY: coordinate,
    endY: coordinate,
    capacity: z.number().int().min(0),
  })
  .refine((slot) => slot.endX >= slot.beginX && slot.endY >= slot.beginY, {
    message: "a slot must end on or after where it begins",
  });

/**
 * `POST /api/machines/save-slot-layout`, the slot layout editor's save.
 *
 * Checks every rule the layout has to follow, not only the shape of the body, so a
 * request that skips the editor still can't store an impossible layout. The rules
 * the editor checks too (overlaps, floating slots) come from the same shared helpers.
 *
 * Whether the slot ids belong to the machine can't be told from the body alone;
 * the service checks that.
 */
export const saveSlotLayoutSchema = z.object({
  body: z
    .object({
      machineId: z.uuid({ message: "machineId must be a uuid" }),
      columns: z.number().int().min(1),
      rows: z.number().int().min(1),
      slots: z.array(slotLayoutSlotSchema),
    })
    .superRefine(({ columns, rows, slots }, ctx) => {
      if (slots.some((slot) => slot.endX >= columns || slot.endY >= rows)) {
        ctx.addIssue({ code: "custom", path: ["slots"], message: "every slot must be inside the grid" });
      }

      const slotNumbers = slots.map((slot) => slot.slotNumber);
      if (new Set(slotNumbers).size !== slotNumbers.length) {
        ctx.addIssue({ code: "custom", path: ["slots"], message: "slot numbers must be unique" });
      }

      const ids = slots.flatMap((slot) => (slot.id ? [slot.id] : []));
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", path: ["slots"], message: "a slot can only appear once" });
      }

      if (hasOverlappingSlots(slots)) {
        ctx.addIssue({ code: "custom", path: ["slots"], message: "slots must not overlap" });
      }

      const floating = findFloatingSlots(slots);
      if (floating.length > 0) {
        const numbers = floating.map((slot) => `#${slot.slotNumber}`).join(", ");
        ctx.addIssue({
          code: "custom",
          path: ["slots"],
          message: `slots must not have empty space below them: ${numbers}`,
        });
      }
    }),
});
