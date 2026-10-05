import { cashSalePayloadSchema, deviceEventBatchSchema, deviceEventSchema } from "@vmaas/shared/schemas";
import { describe, expect, it } from "vitest";
import { DEVICE_MAX_SLOT } from "@vmaas/shared/types/slot";

/**
 * `deviceEventSchema`'s `.refine()` is the crux of Step 1a: a clock-less ESP32
 * sends `uptimeMs` instead of `occurredAt`, and `validate()` runs this schema
 * before the controller — or the service's own clock-fallback arithmetic —
 * ever sees the body. Rejecting "neither present" belongs here, not in a
 * service test, because that is where it is actually enforced.
 */

const body = (overrides: Record<string, unknown>) =>
  deviceEventSchema.safeParse({
    body: {
      type: "cash_sale",
      payload: {},
      ...overrides,
    },
  });

describe("deviceEventSchema", () => {
  it("accepts occurredAt alone", () => {
    expect(body({ occurredAt: "2026-09-21T13:04:11Z" }).success).toBe(true);
  });

  it("accepts uptimeMs alone, for a device with no synchronised clock", () => {
    expect(body({ uptimeMs: 734512 }).success).toBe(true);
  });

  it("accepts both present together", () => {
    expect(body({ occurredAt: "2026-09-21T13:04:11Z", uptimeMs: 734512 }).success).toBe(true);
  });

  // The one case the refine exists for: a line with neither must be rejected
  // here, at the door, rather than reaching the service with no way to date
  // the sale at all.
  it("rejects a body with neither occurredAt nor uptimeMs", () => {
    const result = body({});
    expect(result.success).toBe(false);
  });

  it("still requires a non-empty type", () => {
    expect(body({ occurredAt: "2026-09-21T13:04:11Z", type: "" }).success).toBe(false);
  });
});

/**
 * The batch schema a machine's offline journal drains through. Spec §10
 * requires tests for it and, before this file, none existed:
 * `validate-detailed.test.ts` exercises a local look-alike schema, so a
 * regression in the real `.max(50)` here would break nothing there.
 *
 * These parse the REAL `deviceEventBatchSchema` via `safeParse`, the same way
 * `validateDetailed` does in production.
 */

const MACHINE = "33333333-3333-4333-8333-333333333333";

const event = (overrides: Record<string, unknown> = {}) => ({
  type: "door-released",
  payload: { source: "keypad" },
  occurredAt: "2026-09-21T10:00:00.000Z",
  ...overrides,
});

describe("deviceEventBatchSchema", () => {
  it("rejects an empty events array", () => {
    const result = deviceEventBatchSchema.safeParse({ body: { events: [] } });
    expect(result.success).toBe(false);
  });

  it("rejects 51 events", () => {
    const events = Array.from({ length: 51 }, (_, i) => event({ eventId: `${MACHINE}-${i}` }));
    const result = deviceEventBatchSchema.safeParse({ body: { events } });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 50 events", () => {
    const events = Array.from({ length: 50 }, (_, i) => event({ eventId: `${MACHINE}-${i}` }));
    const result = deviceEventBatchSchema.safeParse({ body: { events } });
    expect(result.success).toBe(true);
  });

  it("rejects a bad occurredAt", () => {
    const result = deviceEventBatchSchema.safeParse({
      body: { events: [event({ occurredAt: "not-a-date" })] },
    });
    expect(result.success).toBe(false);
  });

  // The single-event path already has this test (device.test.ts: "stamps the
  // written event with the machine's own tenant and id, never the body's").
  // The batch schema had no equivalent, and a schema that quietly accepted
  // machineId/tenantId in an event object would invite exactly the confusion
  // that test guards against on the service side. Both fields are simply
  // absent from the shape here — proving the schema draws no such fields out
  // of the body for the controller or service to ever see.
  it("carries no machineId or tenantId through, even when the body sends hostile fields on an event", () => {
    const result = deviceEventBatchSchema.safeParse({
      body: {
        events: [
          event({
            machineId: "11111111-2222-3333-4444-555555555555",
            tenantId: "99999999-9999-4999-8999-999999999999",
          }),
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const parsedEvent = result.data.body.events[0] as Record<string, unknown>;
      expect(parsedEvent.machineId).toBeUndefined();
      expect(parsedEvent.tenantId).toBeUndefined();
    }
  });
});

describe("deviceEventSchema", () => {
  it("rejects a type longer than 64 characters", () => {
    const result = deviceEventSchema.safeParse({ body: event({ type: "x".repeat(65) }) });
    expect(result.success).toBe(false);
  });

  it("accepts a type at exactly 64 characters", () => {
    const result = deviceEventSchema.safeParse({ body: event({ type: "x".repeat(64) }) });
    expect(result.success).toBe(true);
  });
});

describe("cashSalePayloadSchema — the device's slot ceiling", () => {
  const sale = (slot: number) =>
    cashSalePayloadSchema.safeParse({ slot, price_minor: 1500, received_minor: 1500, status: "completed", ledger: "k3f9x2a1" });

  it("accepts the highest slot the device can address", () => {
    expect(sale(DEVICE_MAX_SLOT).success).toBe(true);
  });

  // The firmware indexes `by_slot[MAX_SLOT + 1]`, so a higher number has no
  // cell to land in — it is not merely unusual, it is unrepresentable.
  it("rejects a slot above the ceiling", () => {
    expect(sale(DEVICE_MAX_SLOT + 1).success).toBe(false);
  });

  it("rejects slot 0, since slots are 1-based", () => {
    expect(sale(0).success).toBe(false);
  });
});
