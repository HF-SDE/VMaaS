import { deviceEventSchema } from "@vmaas/shared/schemas";
import { describe, expect, it } from "vitest";

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
