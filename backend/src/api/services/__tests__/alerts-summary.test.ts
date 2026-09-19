import { getAlertsSummaryService } from "@/api/services/alerts.service";

import { ALERTS_SUMMARY_RECENT_LIMIT } from "@vmaas/shared/types/machineAlert";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, groupBy, transaction } = vi.hoisted(() => {
  const findMany = vi.fn();
  const groupBy = vi.fn();
  const transaction = vi.fn(async (queries: unknown[]) => Promise.all(queries as Promise<unknown>[]));
  return { findMany, groupBy, transaction };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    securityAlert: { findMany, groupBy },
    $transaction: transaction,
  },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const MACHINE = "33333333-3333-4333-8333-333333333333";

function alertRow(id: string) {
  return {
    id,
    type: "tamper",
    message: "door opened",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    resolvedAt: null,
    machineId: MACHINE,
    machine: {
      name: "VM-001",
      site: { id: "44444444-4444-4444-8444-444444444444", name: "Canteen", contactPhone: null, contactEmail: null },
    },
  };
}

beforeEach(() => {
  findMany.mockReset();
  groupBy.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getAlertsSummaryService", () => {
  it("reports zero for every alert type when nothing is open", async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);

    const [error, summary] = await getAlertsSummaryService(TENANT);

    expect(error).toBeNull();
    expect(summary!.openByType).toEqual({ tamper: 0, offline: 0, error: 0 });
    expect(summary!.openTotal).toBe(0);
    expect(summary!.recent).toEqual([]);
  });

  it("fills every alert type even when only some have open rows", async () => {
    groupBy.mockResolvedValue([{ type: "tamper", _count: { _all: 2 } }]);
    findMany.mockResolvedValue([]);

    const [, summary] = await getAlertsSummaryService(TENANT);

    expect(summary!.openByType).toEqual({ tamper: 2, offline: 0, error: 0 });
    expect(summary!.openTotal).toBe(2);
  });

  it("scopes both queries to the tenant through the machine join and to open alerts only", async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);

    await getAlertsSummaryService(TENANT);

    expect(groupBy.mock.calls[0]![0].where).toMatchObject({
      machine: { tenantId: TENANT },
      resolvedAt: null,
    });
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      machine: { tenantId: TENANT },
      resolvedAt: null,
    });
  });

  it("orders recent alerts by occurredAt and caps them at the summary limit", async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);

    await getAlertsSummaryService(TENANT);

    expect(findMany.mock.calls[0]![0].orderBy).toEqual({ occurredAt: "desc" });
    expect(findMany.mock.calls[0]![0].take).toBe(ALERTS_SUMMARY_RECENT_LIMIT);
  });

  it("drops a recent alert whose machine has no site rather than lying about the row type", async () => {
    groupBy.mockResolvedValue([]);
    const row = alertRow("55555555-5555-4555-8555-555555555555");
    findMany.mockResolvedValue([{ ...row, machine: { ...row.machine, site: null } }]);

    const [, summary] = await getAlertsSummaryService(TENANT);

    expect(summary!.recent).toEqual([]);
  });

  it("returns UNKNOWN_ERROR rather than throwing when the database fails", async () => {
    groupBy.mockRejectedValue(new Error("connection lost"));
    findMany.mockResolvedValue([]);

    const [error] = await getAlertsSummaryService(TENANT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});
