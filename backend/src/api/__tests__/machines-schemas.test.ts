import { createMachineSchema, disableMachineSchema } from "@vmaas/shared/schemas";
import { describe, expect, it } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";

describe("createMachineSchema", () => {
  it("accepts a machine with just a name", () => {
    const result = createMachineSchema.safeParse({ body: { name: "VM-001" } });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ name: "VM-001" });
  });

  it("requires a name", () => {
    const result = createMachineSchema.safeParse({ body: { name: "   " } });
    expect(result.success).toBe(false);
  });

  it("strips a site, tenant and serial number from the body — none are the caller's to set", () => {
    const result = createMachineSchema.safeParse({
      body: { name: "VM-001", siteId: SITE, tenantId: TENANT, serialNumber: "SN-0001" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ name: "VM-001" });
  });
});

describe("disableMachineSchema", () => {
  it("accepts a reason and defaults revokeCertificate to false", () => {
    const result = disableMachineSchema.safeParse({
      params: { id: MACHINE },
      body: { reason: "malfunctioning" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.body.revokeCertificate).toBe(false);
  });

  it("accepts revokeCertificate: true", () => {
    const result = disableMachineSchema.safeParse({
      params: { id: MACHINE },
      body: { reason: "fraud", revokeCertificate: true },
    });

    expect(result.success).toBe(true);
    expect(result.data?.body.revokeCertificate).toBe(true);
  });

  it("requires a reason", () => {
    const result = disableMachineSchema.safeParse({ params: { id: MACHINE }, body: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a blank reason", () => {
    const result = disableMachineSchema.safeParse({ params: { id: MACHINE }, body: { reason: "   " } });
    expect(result.success).toBe(false);
  });

  it("rejects an id that is not a uuid", () => {
    const result = disableMachineSchema.safeParse({
      params: { id: "not-a-uuid" },
      body: { reason: "fraud" },
    });
    expect(result.success).toBe(false);
  });
});
