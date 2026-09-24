import { beforeEach, describe, expect, it, vi } from "vitest";

const { slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany, machineFindFirst } =
  vi.hoisted(() => ({
    slotFindMany: vi.fn(),
    slotUpdate: vi.fn(),
    slotCreateMany: vi.fn(),
    slotDeleteMany: vi.fn(),
    pinDeleteMany: vi.fn(),
    pinCreateMany: vi.fn(),
    machineFindFirst: vi.fn(),
  }));

const tx = {
  slot: { findMany: slotFindMany, update: slotUpdate, createMany: slotCreateMany, deleteMany: slotDeleteMany },
  pin: { deleteMany: pinDeleteMany, createMany: pinCreateMany },
  machine: { update: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // saveSlotLayoutService looks the machine up with findUnique, not
    // findFirst (unlike every other lookup in this file) — the mock is wired
    // to match that, even though the hoisted variable keeps its brief name.
    machine: { findUnique: machineFindFirst },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { saveSlotLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
// Distinct from MACHINE on purpose: used to prove a test wrong that would
// pass no matter which of the two the service actually wrote pins with.
const OTHER_MACHINE = "55555555-5555-4555-8555-555555555555";
const SLOT_A = "11111111-1111-4111-8111-111111111111";

function body(slots: unknown[], machineId: string = MACHINE) {
  return { machineId, columns: 4, rows: 4, slots } as never;
}

beforeEach(() => {
  for (const fn of [slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany]) {
    fn.mockReset();
  }
  machineFindFirst.mockReset();
  machineFindFirst.mockResolvedValue({ id: MACHINE, slots: [{ id: SLOT_A }] });
  slotFindMany.mockResolvedValue([{ id: SLOT_A, slotNumber: 1 }]);
  slotCreateMany.mockResolvedValue({ count: 0 });
});

describe("saveSlotLayoutService — pins", () => {
  const layout = [
    {
      id: SLOT_A,
      slotNumber: 1,
      beginX: 0,
      endX: 0,
      beginY: 0,
      endY: 0,
      capacity: 10,
      pins: [{ number: 21 }, { number: 22, description: "right spiral" }],
    },
  ];

  // Wholesale replacement rather than a diff: the wiring is at most 32 rows and
  // carries no identity worth preserving, and delete-then-create sidesteps the
  // unique-constraint collision that moving a GPIO between slots would cause.
  it("clears the machine's pins before writing the new ones", async () => {
    await saveSlotLayoutService(body(layout));

    expect(pinDeleteMany).toHaveBeenCalledWith({ where: { machineId: MACHINE } });
    expect(pinDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(pinCreateMany.mock.invocationCallOrder[0]);
  });

  it("takes machineId from the machine, not from anything in the body", async () => {
    // The body claims a different machine (OTHER_MACHINE) than the one the
    // mocked lookup actually finds (MACHINE, from the beforeEach above). A
    // service that copied data.machineId straight into the pin rows would
    // write OTHER_MACHINE here; only reading it off the looked-up machine
    // writes MACHINE, which is what the assertion below requires.
    await saveSlotLayoutService(body(layout, OTHER_MACHINE));

    const { data } = pinCreateMany.mock.calls[0][0];
    expect(data).toEqual([
      { machineId: MACHINE, slotId: SLOT_A, number: 21, description: undefined },
      { machineId: MACHINE, slotId: SLOT_A, number: 22, description: "right spiral" },
    ]);
  });

  it("writes no pin rows when nothing is wired", async () => {
    await saveSlotLayoutService(body([{ ...layout[0], pins: [] }]));

    expect(pinCreateMany).not.toHaveBeenCalled();
  });
});
