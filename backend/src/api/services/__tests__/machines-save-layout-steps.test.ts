import { beforeEach, describe, expect, it, vi } from "vitest";

const { slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany, machineUpdate, machineFindUnique } =
  vi.hoisted(() => ({
    slotFindMany: vi.fn(),
    slotUpdate: vi.fn(),
    slotCreateMany: vi.fn(),
    slotDeleteMany: vi.fn(),
    pinDeleteMany: vi.fn(),
    pinCreateMany: vi.fn(),
    machineUpdate: vi.fn(),
    machineFindUnique: vi.fn(),
  }));

const tx = {
  slot: { findMany: slotFindMany, update: slotUpdate, createMany: slotCreateMany, deleteMany: slotDeleteMany },
  pin: { deleteMany: pinDeleteMany, createMany: pinCreateMany },
  machine: { update: machineUpdate },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findUnique: machineFindUnique },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { saveSlotLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const OTHER_MACHINE = "55555555-5555-4555-8555-555555555555";
const SLOT_A = "11111111-1111-4111-8111-111111111111";

const layout = [
  { id: SLOT_A, slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, capacity: 10, pins: [{ number: 18 }] },
];

function body(stepsPerVend: number, machineId: string = MACHINE) {
  return { machineId, columns: 4, rows: 4, stepsPerVend, slots: layout } as never;
}

beforeEach(() => {
  for (const fn of [slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany, machineUpdate]) {
    fn.mockReset();
  }
  machineFindUnique.mockReset();
  machineFindUnique.mockResolvedValue({ id: MACHINE, slots: [{ id: SLOT_A, slotNumber: 1, quantity: 0 }] });
  slotFindMany.mockResolvedValue([{ id: SLOT_A, slotNumber: 1 }]);
  slotCreateMany.mockResolvedValue({ count: 0 });
});

describe("saveSlotLayoutService — stepsPerVend", () => {
  // Saved in the same transaction as slots and pins: layout, wiring and pulse
  // count are one snapshot, and a publish never sees half of a save.
  it("writes stepsPerVend on the machine inside the transaction", async () => {
    await saveSlotLayoutService(body(3200));

    expect(machineUpdate).toHaveBeenCalledWith({ where: { id: MACHINE }, data: { stepsPerVend: 3200 } });
  });

  // Same guard as the pins: the id comes from the looked-up machine, never
  // from the body, so a body naming another machine cannot retarget the write.
  it("addresses the machine that was looked up, not the body's machineId", async () => {
    await saveSlotLayoutService(body(3200, OTHER_MACHINE));

    expect(machineUpdate.mock.calls[0][0].where).toEqual({ id: MACHINE });
  });

  it("does nothing when the machine does not exist", async () => {
    machineFindUnique.mockResolvedValue(null);

    const [error] = await saveSlotLayoutService(body(3200));

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
    expect(machineUpdate).not.toHaveBeenCalled();
  });
});
