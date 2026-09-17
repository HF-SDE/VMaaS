import { getSlotsSchema, updateSlotSchema } from "@vmaas/shared/schemas";
import { describe, expect, it } from "vitest";

/**
 * The slot schemas are what stand between the router and the service, so what is
 * tested here is the line they draw: which requests reach `updateSlotService` at
 * all, and in what shape.
 *
 * Both are request-shaped (`{ params, body }` / `{ query }`) because that is what
 * `validate()` parses — see `validate.test.ts` for the middleware itself.
 */
const SLOT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const update = (body: unknown) => updateSlotSchema.safeParse({ params: { id: SLOT_ID }, body });

describe("getSlotsSchema", () => {
  it("requires a uuid machineId", () => {
    expect(getSlotsSchema.safeParse({ query: { machineId: PRODUCT_ID } }).success).toBe(true);
    expect(getSlotsSchema.safeParse({ query: {} }).success).toBe(false);
    expect(getSlotsSchema.safeParse({ query: { machineId: "not-a-uuid" } }).success).toBe(false);
  });
});

describe("updateSlotSchema", () => {
  it("rejects an empty body", () => {
    expect(update({}).success).toBe(false);
  });

  it("accepts a body that names a single column", () => {
    expect(update({ quantity: 3 }).success).toBe(true);
  });

  // The refine counts keys, so a cleared price has to survive it — it is a real
  // write, not an absent field.
  it("treats a cleared price as a body", () => {
    const result = update({ price: null });
    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ price: null });
  });

  it("rejects quantities and capacities a column cannot hold", () => {
    expect(update({ quantity: -1 }).success).toBe(false);
    expect(update({ quantity: 1.5 }).success).toBe(false);
    expect(update({ capacity: 0 }).success).toBe(false);
    expect(update({ price: -1 }).success).toBe(false);
  });

  // Whether the quantity fits the capacity depends on the row as it already
  // stands, so the schema lets this pair through and the service judges it.
  it("leaves a quantity above the capacity to the service", () => {
    expect(update({ quantity: 10, capacity: 2 }).success).toBe(true);
  });

  it("coerces the numbers a form sends as strings", () => {
    const result = update({ quantity: "3", capacity: "8" });
    expect(result.data?.body).toEqual({ quantity: 3, capacity: 8 });
  });
});
