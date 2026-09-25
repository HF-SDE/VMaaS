import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineFindFirst } = vi.hoisted(() => ({ machineFindFirst: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { machine: { findFirst: machineFindFirst } } }));

import { getMachineForLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const TENANT = "11111111-1111-4111-8111-111111111111";

function machineRow(tenantId: string | null) {
  return { id: MACHINE, tenantId, site: null, slots: [] };
}

beforeEach(() => {
  machineFindFirst.mockReset();
});

describe("getMachineForLayoutService", () => {
  // The whole point of this change: a cabinet rebuilt in the field must be
  // re-describable, and it belongs to a tenant by then.
  it("returns a machine that already has a tenant", async () => {
    machineFindFirst.mockResolvedValue(machineRow(TENANT));

    const [error, machine] = await getMachineForLayoutService(MACHINE);

    expect(error).toBeNull();
    expect(machine?.id).toBe(MACHINE);
  });

  it("still returns a machine with no tenant", async () => {
    machineFindFirst.mockResolvedValue(machineRow(null));

    const [error] = await getMachineForLayoutService(MACHINE);

    expect(error).toBeNull();
  });

  // The guard that must NOT survive: a tenantId filter would make the first
  // test pass only by accident of the mock ignoring `where`.
  it("does not filter on tenantId", async () => {
    machineFindFirst.mockResolvedValue(machineRow(TENANT));

    await getMachineForLayoutService(MACHINE);

    const { where } = machineFindFirst.mock.calls[0][0];
    expect(where).toEqual({ id: MACHINE });
  });

  it("answers MACHINE_NOT_FOUND for an id that matches nothing", async () => {
    machineFindFirst.mockResolvedValue(null);

    const [error] = await getMachineForLayoutService(MACHINE);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
  });
});
