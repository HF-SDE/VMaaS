import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, transaction } = vi.hoisted(() => {
  const findMany = vi.fn();
  const transaction = vi.fn(async (queries: unknown[]) => Promise.all(queries as Promise<unknown>[]));
  return { findMany, transaction };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    securityAlert: { findMany, count: vi.fn(async () => 0) },
    $transaction: transaction,
  },
}));

import { getAlertsPageService } from "@/api/services/alerts.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ALERT = "55555555-5555-4555-8555-555555555555";
const MACHINE = "33333333-3333-4333-8333-333333333333";

function alertRow(siteId: string | null) {
  return {
    id: ALERT,
    type: "tamper",
    message: "door opened",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    resolvedAt: null,
    machineId: MACHINE,
    machine: {
      name: "VM-001",
      site: siteId ? { id: siteId, name: "Canteen", contactPhone: null, contactEmail: null } : null,
    },
  };
}

beforeEach(() => {
  findMany.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getAlertsPageService — toAlertRow's null branch", () => {
  it("drops an alert whose machine has no site instead of crashing or lying about the type", async () => {
    findMany.mockResolvedValue([alertRow(null)]);

    const [error, page] = await getAlertsPageService(TENANT);

    expect(error).toBeNull();
    expect(page?.data).toEqual([]);
  });

  it("keeps an alert whose machine does have a site", async () => {
    findMany.mockResolvedValue([alertRow("site-1")]);

    const [, page] = await getAlertsPageService(TENANT);

    expect(page?.data).toHaveLength(1);
    expect(page?.data[0]?.siteId).toBe("site-1");
  });

  it("logs the invariant violation rather than dropping it silently", async () => {
    findMany.mockResolvedValue([alertRow(null)]);

    await getAlertsPageService(TENANT);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(ALERT));
  });
});
