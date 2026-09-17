import { z } from "zod/v4";

/** Shared by every `/:id` route, so a malformed id is a 400 rather than a
 *  database error on a value that could never have matched. The controllers
 *  parse it again to read the id as a typed string. */
export const slotIdParamsSchema = z.object({
  params: z.object({
    id: z.uuid({ message: "id must be a uuid" }),
  }),
});

/**
 * `GET /api/slots?machineId=…`, the machine's slot list.
 *
 * `machineId` is required rather than optional: without it the route would list
 * every slot the tenant owns, which is not a view anything asks for. That the
 * machine belongs to the caller's tenant is not something a schema can tell; the
 * service checks it and answers 404 when it does not.
 */
export const getSlotsSchema = z.object({
  query: z.object({
    machineId: z.uuid({ message: "machineId is required" }),
  }),
});

/**
 * The columns a slot write accepts, and the one definition of their bounds —
 * both the endpoint below and the admin's edit form are derived from it, so a
 * bound moves in one place.
 *
 * Plain `z.number()` rather than `z.coerce.number()`, as `createProductSchema`
 * has it: a slot write only ever arrives as a JSON body, where the numbers are
 * already numbers, and a coerced schema's input type is `unknown` — which a form
 * cannot be validated against.
 *
 * `productId` is absent: it is the endpoint's to accept, not a field the admin
 * form offers.
 */
const slotWriteFields = z.object({
  quantity: z.number().int().min(0, { message: "quantity cannot be negative" }),
  capacity: z.number().int().min(1, { message: "capacity must be at least 1" }),
  // Nullable, unlike the rest: `null` clears the override so the slot falls back
  // to what the product costs.
  price: z.number().min(0, { message: "price cannot be negative" }).nullable(),
});

/**
 * What the admin's edit form is held to: all three fields, because it always
 * sends all three.
 *
 * That is also what lets the pair be checked here — `quantity` fitting inside
 * `capacity` needs both numbers, and a partial body only carries the one that
 * changed. The service checks it again against the row as it stands, which is
 * the check that holds when a body names only one of them.
 */
export const slotWriteSchema = slotWriteFields.refine((body) => body.quantity <= body.capacity, {
  message: "quantity cannot exceed the capacity",
  path: ["quantity"],
});

/**
 * Every field is optional so a caller can send only what changed, but an
 * entirely empty body is rejected — it would be a write that silently does
 * nothing while answering 200.
 */
export const updateSlotSchema = z.object({
  params: slotIdParamsSchema.shape.params,
  body: slotWriteFields
    .partial()
    .extend({ productId: z.uuid({ message: "product is required" }).optional() })
    // An absent optional key is dropped by the parse, so a non-empty result is
    // exactly a body that named at least one column — `price: null` included.
    .refine((body) => Object.keys(body).length > 0, {
      message: "at least one of product, quantity, capacity or price is required",
    }),
});
