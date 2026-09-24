import { z } from "zod/v4";

import {
  BOARD_GPIO_MESSAGE,
  isBoardGpio,
  isReservedGpio,
  MAX_OUTPUT_GPIO,
  RESERVED_GPIO_MESSAGE,
  STEPS_PER_VEND_MAX,
  STEPS_PER_VEND_MIN,
} from "../lib/gpio";
import { findFloatingSlots, hasOverlappingSlots } from "../lib/slot-layout";

/** The wording a form shows when the site picker was left empty: a blank picker
 *  sends `""`, which fails the uuid check, so this is what the user reads. */
const SITE_ID_MESSAGE = { message: "site is required" };

/**
 * `POST /api/machines`, superadmin only. The machine is created with neither a
 * tenant nor a site: it is set up (slot layout) first, and later bound to a
 * tenant and a site together by `POST /api/machines/claim`.
 *
 * `serialNumber` is not part of the body: a machine created here has no
 * physical hardware behind it yet, so the service generates one rather than
 * trusting the caller to invent a unique value.
 *
 * `status` and `registrationStatus` are deliberately absent from both write
 * schemas. The first is reported by firmware; the second is moved only by
 * claiming and activating.
 */
export const createMachineSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, { message: "name is required" }),
  }),
});

/**
 * The edit form's validator. Unlike `updateMachineSchema.shape.body` both fields
 * are required: the form always sends both, so a name and a site is what the
 * user should actually be held to.
 */
export const machineFormSchema = z.object({
  name: z.string().trim().min(1, { message: "name is required" }),
  siteId: z.uuid(SITE_ID_MESSAGE),
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
 * `POST /api/machines/:id/publish-configuration`.
 *
 * `fromVersion` turns the call into a rollback: that version's stored payload is
 * written as the next version rather than the machine's current rows being
 * rebuilt. Forward-only, so the history stays a truthful record of what was on
 * the machine and when.
 */
export const publishConfigurationSchema = z.object({
  params: machineIdParamsSchema.shape.params,
  body: z.object({ fromVersion: z.number().int().min(1).optional() }).default({}),
});

/**
 * `GET /api/machines/:id`, which answers the machine plus its KPI block.
 *
 * `days` is the KPI window and is optional — the service defaults it to 30 and
 * clamps what it gets, so a hand-edited `days=99999` still answers a window
 * rather than a 400. Coerced only here, like the paging schemas above.
 */
export const getMachineSchema = z.object({
  params: machineIdParamsSchema.shape.params,
  query: z.object({
    days: z.coerce.number().optional(),
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

/**
 * One motor GPIO on a slot.
 *
 * 0-33 because GPIO 34-39 are input-only on the ESP32, and never 1, 3 or 6-11
 * (console and flash) nor 4, 16, 17 (the motor board's STEP and UART); the same
 * bounds are in shared/lib/gpio.ts and in the firmware, and a value the
 * firmware refuses at boot must not be storable here.
 *
 * The description is a label for whoever traces the cabinet later ("row 2, left
 * bank"). It is stored but never sent to the device — every byte in the wiring
 * payload counts against Motorcontrol's MAX_CONFIG_BYTES.
 */
const slotPinSchema = z.object({
  number: z
    .number()
    .int()
    .min(0, { message: "a GPIO cannot be negative" })
    .max(MAX_OUTPUT_GPIO, { message: "GPIO 34-39 are input-only and cannot drive a motor" })
    .refine((number) => !isReservedGpio(number), { message: RESERVED_GPIO_MESSAGE })
    .refine((number: number) => !isBoardGpio(number), { message: BOARD_GPIO_MESSAGE }),
  description: z.string().trim().max(60).optional(),
});

const slotLayoutSlotSchema = z
  .object({
    id: z.uuid({ message: "slot id must be a uuid" }).optional(),
    slotNumber: z.number().int().min(1),
    beginX: coordinate,
    endX: coordinate,
    beginY: coordinate,
    endY: coordinate,
    capacity: z.number().int().min(0),
    pins: z.array(slotPinSchema).max(6, { message: "a slot can have at most six pins" }).default([]),
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
 *
 * The body also carries the machine-level stepsPerVend, saved in the same
 * transaction as the slots so layout, wiring and pulse count are always one
 * consistent snapshot.
 */
export const saveSlotLayoutSchema = z.object({
  body: z
    .object({
      machineId: z.uuid({ message: "machineId must be a uuid" }),
      columns: z.number().int().min(1),
      rows: z.number().int().min(1),
      stepsPerVend: z
        .number()
        .int()
        .min(STEPS_PER_VEND_MIN, { message: "stepsPerVend must be 1-65535" })
        .max(STEPS_PER_VEND_MAX, { message: "stepsPerVend must be 1-65535" }),
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

      // Across the whole layout, not merely within one slot: Motorcontrol's
      // pin_for() returns the first slot matching a GPIO, so a duplicate
      // anywhere in the machine silently drives the wrong motor.
      const pinNumbers = slots.flatMap((slot) => slot.pins.map((pin) => pin.number));
      if (new Set(pinNumbers).size !== pinNumbers.length) {
        ctx.addIssue({ code: "custom", path: ["slots"], message: "a GPIO can only drive one slot" });
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
