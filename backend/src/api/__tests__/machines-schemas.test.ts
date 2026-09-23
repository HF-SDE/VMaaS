import {
  createMachineSchema,
  disableMachineSchema,
  publishConfigurationSchema,
  saveSlotLayoutSchema,
} from "@vmaas/shared/schemas";
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

/** One valid 1x1 slot at the origin, so each test varies only what it is about. */
function slot(overrides: Record<string, unknown> = {}) {
  return { slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, capacity: 10, ...overrides };
}

function layout(slots: unknown[], columns = 4, rows = 4) {
  return saveSlotLayoutSchema.safeParse({ body: { machineId: MACHINE, columns, rows, slots } });
}

describe("saveSlotLayoutSchema — slot numbering", () => {
  // The device is 1-based (prices.h: "Slots are 1-based") and device.service.ts
  // matches a cash sale straight against this column, so a 0 here would be a slot
  // the machine can never name.
  it("rejects slot number 0", () => {
    expect(layout([slot({ slotNumber: 0 })]).success).toBe(false);
  });

  it("accepts slot number 1", () => {
    expect(layout([slot({ slotNumber: 1 })]).success).toBe(true);
  });
});

describe("saveSlotLayoutSchema — pins", () => {
  it("accepts a slot with no pins, so a layout can be drawn before it is wired", () => {
    expect(layout([slot({ pins: [] })]).success).toBe(true);
  });

  it("accepts several pins on one slot, for merged slots with a motor per spiral", () => {
    expect(layout([slot({ pins: [{ number: 21 }, { number: 22 }] })]).success).toBe(true);
  });

  // 34-39 are input-only on the ESP32 and cannot drive a motor.
  it("rejects a GPIO outside 0-33", () => {
    expect(layout([slot({ pins: [{ number: 34 }] })]).success).toBe(false);
    expect(layout([slot({ pins: [{ number: -1 }] })]).success).toBe(false);
  });

  // One WIRING_SLOT frame holds slot + pin_count + 6 pin bytes.
  it("rejects more than six pins on one slot", () => {
    const pins = [18, 19, 21, 22, 23, 25, 26].map((number) => ({ number }));
    expect(layout([slot({ pins })]).success).toBe(false);
  });

  // pin_for() returns the first match, so a duplicate would drive the wrong motor.
  it("rejects the same GPIO on two different slots", () => {
    const result = layout([
      slot({ slotNumber: 1, pins: [{ number: 18 }] }),
      slot({ slotNumber: 2, beginX: 1, endX: 1, pins: [{ number: 18 }] }),
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects the same GPIO twice on one slot", () => {
    expect(layout([slot({ pins: [{ number: 18 }, { number: 18 }] })]).success).toBe(false);
  });
});

describe("publishConfigurationSchema — a plain publish sends no fromVersion", () => {
  // A superadmin's "Publish" click sends no body at all: `.default({})` on the
  // body is what keeps that a valid plain publish rather than a 400. Without
  // it, this is exactly the kind of thing a schema edit could silently break.
  it("accepts a request with no body key at all", () => {
    const result = publishConfigurationSchema.safeParse({ params: { id: MACHINE } });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({});
  });

  it("accepts an explicit empty body", () => {
    const result = publishConfigurationSchema.safeParse({ params: { id: MACHINE }, body: {} });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({});
  });

  it("accepts a fromVersion to turn the call into a rollback", () => {
    const result = publishConfigurationSchema.safeParse({ params: { id: MACHINE }, body: { fromVersion: 2 } });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ fromVersion: 2 });
  });
});
