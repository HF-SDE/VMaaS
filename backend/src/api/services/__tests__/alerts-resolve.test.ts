import { resolveAlertService } from "@/api/services/alerts.service";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, count, findFirst } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { securityAlert: { updateMany, count, findFirst } },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const ALERT = "55555555-5555-4555-8555-555555555555";
const MACHINE = "33333333-3333-4333-8333-333333333333";

const resolvedRow = {
  id: ALERT,
  type: "tamper",
  message: "door opened",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  resolvedAt: new Date("2026-01-02T00:00:00.000Z"),
  machineId: MACHINE,
  machine: {
    name: "VM-001",
    site: { id: "44444444-4444-4444-8444-444444444444", name: "Canteen", contactPhone: null, contactEmail: null },
  },
};

beforeEach(() => {
  updateMany.mockReset();
  count.mockReset();
  findFirst.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("resolveAlertService", () => {
  it("resolves an open alert belonging to the tenant", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValue(resolvedRow);

    const [error, row] = await resolveAlertService(TENANT, ALERT);

    expect(error).toBeNull();
    expect(row!.resolvedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("scopes the write to the tenant through the machine join and to open alerts only", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValue(resolvedRow);

    await resolveAlertService(TENANT, ALERT);

    expect(updateMany.mock.calls[0]![0].where).toMatchObject({
      id: ALERT,
      resolvedAt: null,
      machine: { tenantId: TENANT },
    });
  });

  it("answers ALERT_NOT_FOUND for an alert belonging to another tenant, without confirming it exists", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    count.mockResolvedValue(0); // scoped to TENANT, so another tenant's row is a miss

    const [error] = await resolveAlertService(OTHER_TENANT, ALERT);

    expect(error?.reason).toBe("ALERT_NOT_FOUND");
  });

  it("answers ALERT_ALREADY_RESOLVED when the row is the tenant's but already closed", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    count.mockResolvedValue(1);

    const [error] = await resolveAlertService(TENANT, ALERT);

    expect(error?.reason).toBe("ALERT_ALREADY_RESOLVED");
  });

  it("does not run the disambiguating count on the success path", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValue(resolvedRow);

    await resolveAlertService(TENANT, ALERT);

    expect(count).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN_ERROR rather than throwing when the write fails", async () => {
    updateMany.mockRejectedValue(new Error("deadlock"));

    const [error] = await resolveAlertService(TENANT, ALERT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});
