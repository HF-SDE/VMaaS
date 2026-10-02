import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  machineFindFirst,
  machineFindMany,
  configFindFirst,
  configCreate,
  commandCreate,
  publishCommand,
  slotFindMany,
  queryRaw,
  movementGroupBy,
  transaction,
} = vi.hoisted(() => ({
  slotFindMany: vi.fn(),
  queryRaw: vi.fn(),
  movementGroupBy: vi.fn(),
  transaction: vi.fn(),
  machineFindFirst: vi.fn(),
  machineFindMany: vi.fn(),
  configFindFirst: vi.fn(),
  configCreate: vi.fn(),
  commandCreate: vi.fn(),
  publishCommand: vi.fn(),
}));

const tx = {
  machineConfiguration: { findFirst: configFindFirst, create: configCreate },
  machineCommand: { create: commandCreate },
  // What the stock block reads (spec: slot stock).
  slot: { findMany: slotFindMany },
  $queryRaw: queryRaw,
  inventoryMovement: { groupBy: movementGroupBy },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findFirst: machineFindFirst, findMany: machineFindMany },
    $transaction: transaction,
  },
}));

vi.mock("@/mqtt/commands", () => ({ publishCommand }));

import {
  publishConfigurationService,
  publishInitialConfigurationService,
  publishSlotStateForProductService,
  publishSlotStateService,
} from "@/api/services/configuration.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function machine(slots: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id: MACHINE,
    tenantId: "11111111-1111-4111-8111-111111111111",
    siteId: "22222222-2222-4222-8222-222222222222",
    stepsPerVend: 6400,
    slots,
    ...overrides,
  };
}

const wiredSlot = { slotNumber: 1, price: 15, product: null, pins: [{ number: 18 }] };

beforeEach(() => {
  for (const fn of [
    machineFindFirst,
    machineFindMany,
    configFindFirst,
    configCreate,
    commandCreate,
    publishCommand,
    slotFindMany,
    queryRaw,
    movementGroupBy,
    transaction,
  ])
    fn.mockReset();
  transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  slotFindMany.mockResolvedValue([{ id: "slot-1", slotNumber: 1, quantity: 5 }]);
  // One row per ledger the machine has sold under, newest first.
  queryRaw.mockResolvedValue([{ ledger: "k3f9x2a1", asOfSequence: 41n }]);
  movementGroupBy.mockResolvedValue([{ slotId: "slot-1", _max: { occurredAt: new Date("2026-09-29T09:14:00.000Z") } }]);
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

  // Every other fixture in this file uses 6400, which is also the default —
  // a service that hard-coded 6400 or dropped stepsPerVend from its `select`
  // would still pass those. A distinct value here proves the published value
  // actually comes from the machine row.
  it("publishes the machine's own stepsPerVend, not a hard-coded default", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot], { stepsPerVend: 3200 }));

    await publishConfigurationService(MACHINE, USER);

    expect(machineFindFirst.mock.calls[0][0].select.stepsPerVend).toBe(true);
    expect(configCreate.mock.calls[0][0].data.payload.wiring.motor).toEqual({ stepsPerVend: 3200 });
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
    // Everything but stock is the old version's; stock is always live (spec: slot stock).
    const { stock, ...rest } = configCreate.mock.calls[0][0].data.payload;
    expect(rest).toEqual(oldPayload);
    expect(stock).toMatchObject({ acks: [{ ledger: "k3f9x2a1", asOfSequence: 41 }] });
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

// A machine is set up through activation, and the pins given in the admin
// layout must reach it then, without anyone pressing publish. Later changes
// still need a deliberate publish (the review step), so this only ever writes
// the first version.
describe("publishInitialConfigurationService", () => {
  it("publishes v1 from the saved layout when the machine has no configuration", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    configFindFirst.mockResolvedValue(null);

    const [error, result] = await publishInitialConfigurationService(MACHINE);

    expect(error).toBeNull();
    expect(result).toEqual({ published: true, version: 1 });
    const data = configCreate.mock.calls[0][0].data;
    expect(data.createdById).toBeNull();
    expect(data.payload.wiring.slots).toEqual([{ slot: 1, pins: [18] }]);
  });

  it("leaves a machine that already has a configuration alone", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    configFindFirst.mockResolvedValue({ version: 3 });

    const [error, result] = await publishInitialConfigurationService(MACHINE);

    expect(error).toBeNull();
    expect(result).toEqual({ published: false });
    expect(configCreate).not.toHaveBeenCalled();
    expect(publishCommand).not.toHaveBeenCalled();
  });

  it("does not publish a layout with an unwired slot", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot, { ...wiredSlot, slotNumber: 2, pins: [] }]));
    configFindFirst.mockResolvedValue(null);

    const [error] = await publishInitialConfigurationService(MACHINE);

    expect(error?.reason).toBe("SLOTS_NOT_WIRED");
    expect(configCreate).not.toHaveBeenCalled();
  });
});

// Customers change prices themselves (PATCH /slots/:id, PATCH /products/:id),
// and the machine must follow without a superadmin publishing. Only `prices`
// may change this way: the wiring is copied from the last published version,
// so a customer can never send pins that were not reviewed.
describe("publishSlotStateService", () => {
  const publishedWiring = { version: 2, motor: { stepsPerVend: 6400 }, slots: [{ slot: 1, pins: [21] }] };
  const published = {
    version: 3,
    payload: {
      cash: {},
      prices: [{ slot: 1, priceMinor: 1500 }],
      wiring: publishedWiring,
      // What the default mocks read back, so only a price edit counts as a change here.
      stock: {
        acks: [{ ledger: "k3f9x2a1", asOfSequence: 41 }],
        slots: [{ slot: 1, quantity: 5, countedAt: "2026-09-29T09:14:00.000Z" }],
      },
    },
  };
  const named = (slots: unknown[], overrides: Record<string, unknown> = {}) =>
    machine(slots, { name: "Lobby", status: "online", ...overrides });

  it("publishes the new prices on top of the last published wiring and reports it sent", async () => {
    // The layout's pins have been edited (18) but not published: they must not leak out.
    machineFindFirst.mockResolvedValue(named([{ ...wiredSlot, price: 20 }]));
    configFindFirst.mockResolvedValue(published);

    const [error, result] = await publishSlotStateService(MACHINE, USER);

    expect(error).toBeNull();
    expect(result).toMatchObject({ machineId: MACHINE, machineName: "Lobby", status: "sent" });
    expect(result?.commandId).toMatch(/^cfg-/);
    const data = configCreate.mock.calls[0][0].data;
    expect(data.version).toBe(4);
    expect(data.payload.prices).toEqual([{ slot: 1, priceMinor: 2000 }]);
    expect(data.payload.wiring).toEqual(publishedWiring);
    expect(data.createdById).toBe(USER);
    expect(publishCommand.mock.calls[0][1]).toEqual({ type: "apply_configuration", version: 4 });
  });

  it("publishes for an offline machine too, and says it is offline", async () => {
    machineFindFirst.mockResolvedValue(named([{ ...wiredSlot, price: 20 }], { status: "offline" }));
    configFindFirst.mockResolvedValue(published);

    const [, result] = await publishSlotStateService(MACHINE, USER);

    expect(result?.status).toBe("offline");
    expect(result?.commandId).toMatch(/^cfg-/);
    expect(configCreate).toHaveBeenCalledTimes(1);
    expect(commandCreate).toHaveBeenCalledTimes(1);
  });

  it("writes no version when the prices did not change", async () => {
    machineFindFirst.mockResolvedValue(named([{ ...wiredSlot, price: 15 }]));
    configFindFirst.mockResolvedValue(published);

    const [error, result] = await publishSlotStateService(MACHINE, USER);

    expect(error).toBeNull();
    expect(result).toEqual({ machineId: MACHINE, machineName: "Lobby", status: "unchanged", commandId: null });
    expect(configCreate).not.toHaveBeenCalled();
    expect(publishCommand).not.toHaveBeenCalled();
  });

  it("does nothing for a machine that has never been published", async () => {
    machineFindFirst.mockResolvedValue(named([{ ...wiredSlot, price: 20 }]));
    configFindFirst.mockResolvedValue(null);

    const [error, result] = await publishSlotStateService(MACHINE, USER);

    expect(error).toBeNull();
    expect(result?.status).toBe("not_published");
    expect(configCreate).not.toHaveBeenCalled();
  });

  it("leaves a slot with neither price nor product out of the prices", async () => {
    machineFindFirst.mockResolvedValue(
      named([
        { ...wiredSlot, price: 20 },
        { ...wiredSlot, slotNumber: 2, price: null, product: null },
      ]),
    );
    configFindFirst.mockResolvedValue(published);

    await publishSlotStateService(MACHINE, USER);

    expect(configCreate.mock.calls[0][0].data.payload.prices).toEqual([{ slot: 1, priceMinor: 2000 }]);
  });
});

describe("publishSlotStateForProductService", () => {
  it("republishes every machine of the tenant that sells the product at its own price", async () => {
    machineFindMany.mockResolvedValue([{ id: "m-a" }, { id: "m-b" }]);
    machineFindFirst.mockResolvedValue(null); // each per-machine publish answers MACHINE_NOT_FOUND; only the fan-out is under test

    const outcomes = await publishSlotStateForProductService("t-1", "p-1", USER);

    const where = machineFindMany.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: "t-1", slots: { some: { productId: "p-1", price: null } } });
    expect(machineFindFirst.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id)).toEqual([
      "m-a",
      "m-b",
    ]);
    // A machine whose publish failed is logged, not reported as an outcome.
    expect(outcomes).toEqual([]);
  });

  it("returns one outcome per machine it published", async () => {
    machineFindMany.mockResolvedValue([{ id: MACHINE }]);
    machineFindFirst.mockResolvedValue(
      machine([{ ...wiredSlot, price: null, product: { price: 25 } }], { name: "Lobby", status: "online" }),
    );
    configFindFirst.mockResolvedValue({ version: 3, payload: { prices: [{ slot: 1, priceMinor: 1500 }] } });

    const outcomes = await publishSlotStateForProductService("t-1", "p-1", USER);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ machineId: MACHINE, status: "sent" });
  });
});

describe("stock in published configurations", () => {
  const expectedStock = {
    acks: [{ ledger: "k3f9x2a1", asOfSequence: 41 }],
    slots: [{ slot: 1, quantity: 5, countedAt: "2026-09-29T09:14:00.000Z" }],
  };

  it("puts stock in a full publish", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    await publishConfigurationService(MACHINE, USER);
    expect(configCreate.mock.calls[0][0].data.payload.stock).toEqual(expectedStock);
  });

  it("reads stock inside a RepeatableRead transaction", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    await publishConfigurationService(MACHINE, USER);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });

  it("acknowledges every recent ledger, newest first, capped at four", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    queryRaw.mockResolvedValue([
      { ledger: "bbbb2222", asOfSequence: 3n },
      { ledger: "aaaa1111", asOfSequence: 41n },
    ]);
    await publishConfigurationService(MACHINE, USER);
    expect(configCreate.mock.calls[0][0].data.payload.stock.acks).toEqual([
      { ledger: "bbbb2222", asOfSequence: 3 },
      { ledger: "aaaa1111", asOfSequence: 41 },
    ]);
    const sql = (queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("LIMIT 4");
    expect(queryRaw.mock.calls[0][1]).toBe(MACHINE);
  });

  it("acknowledges nothing for a machine that never sold", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    queryRaw.mockResolvedValue([]);
    await publishConfigurationService(MACHINE, USER);
    expect(configCreate.mock.calls[0][0].data.payload.stock.acks).toEqual([]);
  });

  it("refreshes stock when rolling back to an older version", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    configFindFirst.mockResolvedValueOnce({ payload: { cash: {}, prices: [], wiring: {}, stock: { acks: [{ ledger: "old", asOfSequence: 1 }], slots: [] } } });
    configFindFirst.mockResolvedValueOnce({ version: 3 });
    await publishConfigurationService(MACHINE, USER, 2);
    expect(configCreate.mock.calls[0][0].data.payload.stock).toEqual(expectedStock);
  });

  it("publishSlotStateService writes no version when prices and stock are unchanged", async () => {
    machineFindFirst.mockResolvedValue(machine([{ ...wiredSlot, price: 15 }], { name: "Lobby", status: "online" }));
    configFindFirst.mockResolvedValue({
      version: 3,
      payload: { cash: {}, prices: [{ slot: 1, priceMinor: 1500 }], wiring: {}, stock: expectedStock },
    });
    const [, result] = await publishSlotStateService(MACHINE, USER);
    expect(result?.status).toBe("unchanged");
    expect(configCreate).not.toHaveBeenCalled();
  });

  it("publishSlotStateService publishes a stock-only change", async () => {
    machineFindFirst.mockResolvedValue(machine([{ ...wiredSlot, price: 15 }], { name: "Lobby", status: "online" }));
    configFindFirst.mockResolvedValue({
      version: 3,
      payload: { cash: {}, prices: [{ slot: 1, priceMinor: 1500 }], wiring: { kept: true }, stock: { ...expectedStock, acks: [{ ledger: "k3f9x2a1", asOfSequence: 40 }] } },
    });
    const [, result] = await publishSlotStateService(MACHINE, USER);
    expect(result?.status).toBe("sent");
    const payload = configCreate.mock.calls[0][0].data.payload;
    expect(payload.stock).toEqual(expectedStock);
    expect(payload.wiring).toEqual({ kept: true });
  });
});
