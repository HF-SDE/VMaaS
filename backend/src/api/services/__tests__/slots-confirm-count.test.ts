import { beforeEach, describe, expect, it, vi } from "vitest";

const { slotFindFirst, movementCreate } = vi.hoisted(() => ({ slotFindFirst: vi.fn(), movementCreate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) =>
      fn({ slot: { findFirst: slotFindFirst }, inventoryMovement: { create: movementCreate } }),
  },
}));

import { confirmSlotCountService } from "@/api/services/slots.service";

beforeEach(() => {
  slotFindFirst.mockReset();
  movementCreate.mockReset();
});

describe("confirmSlotCountService", () => {
  it("records a zero correction as the slot's count, credited to the user", async () => {
    slotFindFirst.mockResolvedValue({ id: "slot-1", machineId: "m-1", quantity: 7 });

    const [error, slot] = await confirmSlotCountService("t-1", "slot-1", "u-1");

    expect(error).toBeNull();
    expect(slot).toMatchObject({ id: "slot-1", machineId: "m-1" });
    expect(slotFindFirst.mock.calls[0][0].where).toEqual({ id: "slot-1", machine: { tenantId: "t-1" } });
    expect(movementCreate.mock.calls[0][0].data).toEqual({
      tenantId: "t-1",
      slotId: "slot-1",
      userId: "u-1",
      type: "correction",
      quantity: 0,
      note: "Count confirmed in the admin",
    });
  });

  it("answers SLOT_NOT_FOUND for a slot of another tenant", async () => {
    slotFindFirst.mockResolvedValue(null);

    const [error] = await confirmSlotCountService("t-1", "slot-x", "u-1");

    expect(error?.reason).toBe("SLOT_NOT_FOUND");
    expect(movementCreate).not.toHaveBeenCalled();
  });
});
