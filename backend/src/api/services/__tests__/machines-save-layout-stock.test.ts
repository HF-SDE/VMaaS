import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineFindUnique, slotDeleteMany, transaction } = vi.hoisted(() => ({
  machineFindUnique: vi.fn(),
  slotDeleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findUnique: machineFindUnique },
    $transaction: transaction,
  },
}));

import { saveSlotLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const SLOT_A = "11111111-1111-4111-8111-111111111111";
const SLOT_B = "22222222-2222-4222-8222-222222222222";

/** A layout that keeps SLOT_A and drops whatever else the machine has. */
function layoutKeepingA() {
  return {
    machineId: MACHINE,
    columns: 4,
    rows: 4,
    slots: [
      { id: SLOT_A, slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, capacity: 10, pins: [] },
    ],
  } as never;
}

beforeEach(() => {
  machineFindUnique.mockReset();
  slotDeleteMany.mockReset();
  transaction.mockReset();
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      slot: { deleteMany: slotDeleteMany, update: vi.fn(), createMany: vi.fn(), findMany: vi.fn(async () => []) },
      pin: { deleteMany: vi.fn(), createMany: vi.fn() },
    }),
  );
});

describe("saveSlotLayoutService — deleting a slot that holds stock", () => {
  it("refuses the whole save and names the slots", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [
        { id: SLOT_A, slotNumber: 1, quantity: 0 },
        { id: SLOT_B, slotNumber: 5, quantity: 7 },
      ],
    });

    const [error] = await saveSlotLayoutService(layoutKeepingA());

    if (error?.reason !== "SLOTS_NOT_EMPTY") {
      throw new Error(`expected SLOTS_NOT_EMPTY, got ${error?.reason ?? "no error"}`);
    }

    expect(error.slots).toEqual([5]);
  });

  // Nothing at all may be written — a partial save would renumber the slots
  // that stay while leaving the refused one behind.
  it("writes nothing when it refuses", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [
        { id: SLOT_A, slotNumber: 1, quantity: 0 },
        { id: SLOT_B, slotNumber: 5, quantity: 7 },
      ],
    });

    await saveSlotLayoutService(layoutKeepingA());

    expect(transaction).not.toHaveBeenCalled();
  });

  it("allows deleting a slot that is empty", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [
        { id: SLOT_A, slotNumber: 1, quantity: 0 },
        { id: SLOT_B, slotNumber: 5, quantity: 0 },
      ],
    });

    const [error] = await saveSlotLayoutService(layoutKeepingA());

    expect(error).toBeNull();
    expect(slotDeleteMany).toHaveBeenCalled();
  });

  // A slot that stays keeps its stock, so its quantity is none of this rule's
  // business — only removal is.
  it("ignores the stock of a slot the layout keeps", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [{ id: SLOT_A, slotNumber: 1, quantity: 42 }],
    });

    const [error] = await saveSlotLayoutService(layoutKeepingA());

    expect(error).toBeNull();
  });
});
