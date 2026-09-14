import { createSiteSchema, siteIdParamsSchema, updateSiteSchema } from "@vmaas/shared/schemas";
import { describe, expect, it } from "vitest";

/**
 * The sites schemas are the only part of the slice that is pure enough to test
 * without a database, and they carry the two rules a reader would otherwise
 * have to infer: blank optional fields mean "unset" on create but "clear" on
 * update, and an update that changes nothing is rejected rather than answered
 * with a 200 that wrote nothing.
 */
describe("createSiteSchema", () => {
  it("requires a name", () => {
    expect(createSiteSchema.safeParse({ body: { name: "" } }).success).toBe(false);
    expect(createSiteSchema.safeParse({ body: {} }).success).toBe(false);
  });

  it("accepts a name on its own — every other column is nullable", () => {
    const { success, data } = createSiteSchema.safeParse({ body: { name: "Warehouse North" } });

    expect(success).toBe(true);
    expect(data?.body.name).toBe("Warehouse North");
    expect(data?.body.city).toBeUndefined();
  });

  it("drops a blank optional field rather than storing an empty string", () => {
    const { data } = createSiteSchema.safeParse({
      body: { name: "Warehouse North", city: "   ", addressLine1: "Kullinggade 6A" },
    });

    expect(data?.body.city).toBeUndefined();
    expect(data?.body.addressLine1).toBe("Kullinggade 6A");
  });

  it("rejects a malformed contact email", () => {
    const parsed = createSiteSchema.safeParse({ body: { name: "Warehouse North", contactEmail: "not-an-email" } });

    expect(parsed.success).toBe(false);
  });

  it("upper-cases a two-letter country code", () => {
    const { data } = createSiteSchema.safeParse({ body: { name: "Warehouse North", countryCode: "dk" } });

    expect(data?.body.countryCode).toBe("DK");
  });
});

describe("updateSiteSchema", () => {
  const params = { id: "3f1a7b2c-0d4e-4f6a-8b9c-1d2e3f4a5b6c" };

  it("rejects a body that changes nothing", () => {
    expect(updateSiteSchema.safeParse({ params, body: {} }).success).toBe(false);
  });

  it("maps a blank optional field to null, so the user can clear it", () => {
    const { data } = updateSiteSchema.safeParse({ params, body: { city: "" } });

    expect(data?.body.city).toBeNull();
  });

  it("leaves an omitted field undefined, so it is not written at all", () => {
    const { data } = updateSiteSchema.safeParse({ params, body: { name: "Warehouse South" } });

    expect(data?.body.name).toBe("Warehouse South");
    expect(data?.body.city).toBeUndefined();
  });
});

describe("siteIdParamsSchema", () => {
  it("rejects an id that is not a uuid", () => {
    expect(siteIdParamsSchema.safeParse({ params: { id: "paginated" } }).success).toBe(false);
  });
});
