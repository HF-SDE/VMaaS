import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineFindFirst, configFindFirst, configCreate, commandCreate, publishCommand } = vi.hoisted(() => ({
  machineFindFirst: vi.fn(),
  configFindFirst: vi.fn(),
  configCreate: vi.fn(),
  commandCreate: vi.fn(),
  publishCommand: vi.fn(),
}));

const tx = {
  machineConfiguration: { findFirst: configFindFirst, create: configCreate },
  machineCommand: { create: commandCreate },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findFirst: machineFindFirst },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock("@/mqtt/commands", () => ({ publishCommand }));

import { publishConfigurationService } from "@/api/services/configuration.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function machine(slots: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id: MACHINE,
    tenantId: "11111111-1111-4111-8111-111111111111",
    siteId: "22222222-2222-4222-8222-222222222222",
    slots,
    ...overrides,
  };
}

const wiredSlot = { slotNumber: 1, price: 15, product: null, pins: [{ number: 18 }] };

beforeEach(() => {
  for (const fn of [machineFindFirst, configFindFirst, configCreate, commandCreate, publishCommand]) fn.mockReset();
  configFindFirst.mockResolvedValue({ version: 3 });
  configCreate.mockImplementation(async (args: { data: { version: number } }) => ({ version: args.data.version }));
  commandCreate.mockImplementation(async (args: { data: { commandId: string } }) => args.data);
});

describe("publishConfigurationService", () => {
  it("refuses to publish while a slot has no pins, and names it", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot, { ...wiredSlot, slotNumber: 2, pins: [] }]));

    const [error] = await publishConfigurationService(MACHINE, USER);

    expect(error?.reason).toBe("SLOTS_NOT_WIRED");
    expect(error?.slots).toEqual([2]);
    expect(configCreate).not.toHaveBeenCalled();
  });

  it("refuses a machine with no slots at all", async () => {
    machineFindFirst.mockResolvedValue(machine([]));

    const [error] = await publishConfigurationService(MACHINE, USER);

    expect(error?.reason).toBe("NO_SLOTS");
  });

  it("answers MACHINE_NOT_FOUND rather than throwing", async () => {
    machineFindFirst.mockResolvedValue(null);

    const [error] = await publishConfigurationService(MACHINE, USER);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
  });

  it("writes the next version and attributes it", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));

    const [error, result] = await publishConfigurationService(MACHINE, USER);

    expect(error).toBeNull();
    expect(result?.version).toBe(4);
    expect(configCreate.mock.calls[0][0].data.createdById).toBe(USER);
  });

  it("starts at version 1 for a machine that has never been published", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    configFindFirst.mockResolvedValue(null);

    const [, result] = await publishConfigurationService(MACHINE, USER);

    expect(result?.version).toBe(1);
  });

  // The command carries only the version, never the payload: the device always
  // fetches the latest, so a delayed QoS-1 delivery cannot write an older wiring
  // over a newer one.
  it("announces the version, not the payload", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));

    await publishConfigurationService(MACHINE, USER);

    const [, payload] = publishCommand.mock.calls[0];
    expect(payload).toEqual({ type: "apply_configuration", version: 4 });
  });

  // One case the slot layout editor's loader can still produce: a machine
  // with no tenant yet. The wiring is a physical property of the cabinet set
  // before anyone owns it, so the configuration must still be stored — but
  // there is no topic to publish on and nobody to notify, so nothing is
  // announced.
  it("stores the configuration for a tenant-less machine, but announces nothing", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot], { tenantId: null, siteId: null }));

    const [error, result] = await publishConfigurationService(MACHINE, USER);

    expect(error).toBeNull();
    expect(result?.version).toBe(4);
    expect(result?.commandId).toBeNull();
    expect(configCreate).toHaveBeenCalledTimes(1);
    expect(commandCreate).not.toHaveBeenCalled();
    expect(publishCommand).not.toHaveBeenCalled();
  });
});

describe("publishConfigurationService — rollback", () => {
  // Rollback is a forward-only operation: the old payload is written as a NEW
  // version. Nothing is mutated or deleted, so the history stays a truthful
  // record of what was on the machine and when.
  it("republishes an earlier version's payload as the next version", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    const oldPayload = { cash: {}, prices: [], wiring: { version: 2, slots: [{ slot: 1, pins: [9] }] } };
    configFindFirst.mockImplementation(async (args: { where: { version?: number } }) =>
      args.where.version === 2 ? { version: 2, payload: oldPayload } : { version: 3 },
    );

    const [error, result] = await publishConfigurationService(MACHINE, USER, 2);

    expect(error).toBeNull();
    expect(result?.version).toBe(4);
    expect(configCreate.mock.calls[0][0].data.payload).toEqual(oldPayload);
  });

  it("answers VERSION_NOT_FOUND for a version the machine never had", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    configFindFirst.mockImplementation(async (args: { where: { version?: number } }) =>
      args.where.version === 9 ? null : { version: 3 },
    );

    const [error] = await publishConfigurationService(MACHINE, USER, 9);

    expect(error?.reason).toBe("VERSION_NOT_FOUND");
  });

  // A rollback restores a wiring that was valid when it was published. Holding it
  // to the machine's present slots would make the control useless exactly when it
  // is needed — after a bad edit.
  it("does not re-run the unwired check when rolling back", async () => {
    machineFindFirst.mockResolvedValue(machine([{ ...wiredSlot, slotNumber: 2, pins: [] }]));
    configFindFirst.mockImplementation(async (args: { where: { version?: number } }) =>
      args.where.version === 2 ? { version: 2, payload: { cash: {}, prices: [], wiring: { version: 2, slots: [] } } } : { version: 3 },
    );

    const [error] = await publishConfigurationService(MACHINE, USER, 2);

    expect(error).toBeNull();
  });

  // The tenant gate (Task 7) and the transaction-scoped version lookup (this
  // task) intersect exactly here: a rollback must go THROUGH the same
  // tenantId/siteId gate as a plain publish, not around it.
  it("rolls back a tenant-less machine's configuration, but announces nothing", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot], { tenantId: null, siteId: null }));
    const oldPayload = { cash: {}, prices: [], wiring: { version: 2, slots: [{ slot: 1, pins: [9] }] } };
    configFindFirst.mockImplementation(async (args: { where: { version?: number } }) =>
      args.where.version === 2 ? { version: 2, payload: oldPayload } : { version: 3 },
    );

    const [error, result] = await publishConfigurationService(MACHINE, USER, 2);

    expect(error).toBeNull();
    expect(result?.version).toBe(4);
    expect(result?.commandId).toBeNull();
    expect(configCreate).toHaveBeenCalledTimes(1);
    expect(commandCreate).not.toHaveBeenCalled();
    expect(publishCommand).not.toHaveBeenCalled();
  });
});
