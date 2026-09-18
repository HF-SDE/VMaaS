import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, findFirst, transaction } = vi.hoisted(() => {
  const findMany = vi.fn();
  const findFirst = vi.fn();
  // getMachinesPageService and getMachineByIdService both run inside
  // `$transaction`/aggregate helpers — a passthrough is enough for what these
  // tests exercise.
  const transaction = vi.fn(async (queries: unknown[]) => Promise.all(queries as Promise<unknown>[]));
  return { findMany, findFirst, transaction };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findMany, findFirst, count: vi.fn(async () => 0) },
    $transaction: transaction,
  },
}));

import { getMachineByIdService, getMachinesService } from "@/api/services/machines.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const GOOD_MACHINE = "44444444-4444-4444-8444-444444444444";

function machineWithSite(id: string) {
  return { id, name: "VM-001", tenantId: TENANT, site: { id: "site-1", name: "Canteen", city: null } };
}

function machineWithoutSite(id: string) {
  // A machine with a tenant but no site: the invariant this whole revert
  // relies on should never let this exist, but the read path must not crash
  // or lie about the type if it somehow does.
  return { id, name: "VM-002", tenantId: TENANT, site: null };
}

beforeEach(() => {
  findMany.mockReset();
  findFirst.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getMachinesService — narrowToSite's null branch", () => {
  it("drops a machine whose site is null instead of crashing or lying about the type", async () => {
    findMany.mockResolvedValue([machineWithSite(GOOD_MACHINE), machineWithoutSite(MACHINE)]);

    const [error, machines] = await getMachinesService(TENANT);

    expect(error).toBeNull();
    expect(machines?.map((m) => m.id)).toEqual([GOOD_MACHINE]);
  });

  it("logs the invariant violation rather than dropping it silently", async () => {
    findMany.mockResolvedValue([machineWithoutSite(MACHINE)]);

    await getMachinesService(TENANT);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(MACHINE));
  });
});

describe("getMachineByIdService — narrowToSite's null branch", () => {
  it("reads a site-less machine as not-found rather than crashing or lying about the type", async () => {
    findFirst.mockResolvedValue({ ...machineWithoutSite(MACHINE), _count: { slots: 0, sales: 0 } });

    const [error, machine] = await getMachineByIdService(TENANT, MACHINE);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
    expect(machine).toBeNull();
  });
});
