import { createMachineSchema, disableMachineSchema } from "@vmaas/shared/schemas";
import { describe, expect, it } from "vitest";

const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";

describe("createMachineSchema", () => {
  it("accepts a machine created at a site", () => {
    const result = createMachineSchema.safeParse({
      body: { name: "VM-001", siteId: SITE },
    });

    expect(result.success).toBe(true);
    expect(result.data?.body.siteId).toBe(SITE);
  });

  it("requires a site", () => {
    const result = createMachineSchema.safeParse({ body: { name: "VM-001" } });
    expect(result.success).toBe(false);
  });

  it("does not accept a serial number in the body — the service generates one", () => {
    const result = createMachineSchema.safeParse({
      body: { name: "VM-001", siteId: SITE, serialNumber: "SN-0001" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.body).not.toHaveProperty("serialNumber");
  });

  it("rejects a siteId that is not a uuid", () => {
    const result = createMachineSchema.safeParse({
      body: { name: "VM-001", siteId: "copenhagen" },
    });
    expect(result.success).toBe(false);
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
