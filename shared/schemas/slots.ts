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
 * Every field is optional so the form can send only what changed, but an
 * entirely empty body is rejected — it would be a write that silently does
 * nothing while answering 200.
 *
 * `quantity` and `capacity` are bounded here only against nonsense a column
 * cannot hold; that the one fits inside the other depends on the row as it
 * already stands, so the service is what judges it.
 */
export const updateSlotSchema = z.object({
  params: slotIdParamsSchema.shape.params,
  body: z
    .object({
      productId: z.uuid({ message: "product is required" }).optional(),
      quantity: z.coerce.number().int().min(0, { message: "quantity cannot be negative" }).optional(),
      capacity: z.coerce.number().int().min(1, { message: "capacity must be at least 1" }).optional(),
      // Nullable, unlike the rest: `null` clears the override so the slot falls
      // back to what the product costs.
      price: z.coerce.number().min(0, { message: "price cannot be negative" }).nullable().optional(),
    })
    // An absent optional key is dropped by the parse, so a non-empty result is
    // exactly a body that named at least one column — `price: null` included.
    .refine((body) => Object.keys(body).length > 0, {
      message: "at least one of product, quantity, capacity or price is required",
    }),
});
