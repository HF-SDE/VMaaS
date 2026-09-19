import { selectLowStockSlots } from "@/api/services/slots.service";

import { describe, expect, it } from "vitest";

function candidate(overrides: { quantity: number; capacity: number; slotNumber?: number }) {
  return {
    id: `slot-${overrides.slotNumber ?? overrides.quantity}`,
    slotNumber: overrides.slotNumber ?? 1,
    quantity: overrides.quantity,
    capacity: overrides.capacity,
    product: { name: "Cola Zero" },
    machine: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "VM-001",
      site: { id: "44444444-4444-4444-8444-444444444444", name: "Canteen" },
    },
  };
}

describe("selectLowStockSlots", () => {
  it("includes a slot exactly at the ratio, since the threshold is inclusive", () => {
    expect(selectLowStockSlots([candidate({ quantity: 4, capacity: 20 })])).toHaveLength(1);
  });

  it("excludes a slot just above the ratio", () => {
    expect(selectLowStockSlots([candidate({ quantity: 5, capacity: 20 })])).toHaveLength(0);
  });

  it("excludes a zero-capacity slot rather than dividing by zero", () => {
    expect(selectLowStockSlots([candidate({ quantity: 0, capacity: 0 })])).toEqual([]);
  });

  it("sorts empty slots above merely low ones", () => {
    const rows = selectLowStockSlots([
      candidate({ quantity: 2, capacity: 20, slotNumber: 1 }),
      candidate({ quantity: 0, capacity: 20, slotNumber: 2 }),
    ]);

    expect(rows.map((row) => row.slotNumber)).toEqual([2, 1]);
  });

  it("sorts the rest by how empty they are, emptiest first", () => {
    const rows = selectLowStockSlots([
      candidate({ quantity: 4, capacity: 20, slotNumber: 1 }), // 20%
      candidate({ quantity: 1, capacity: 20, slotNumber: 2 }), // 5%
      candidate({ quantity: 2, capacity: 20, slotNumber: 3 }), // 10%
    ]);

    expect(rows.map((row) => row.slotNumber)).toEqual([2, 3, 1]);
  });

  it("caps the queue so a badly stocked fleet cannot flood a summary card", () => {
    const many = Array.from({ length: 60 }, (_, index) => candidate({ quantity: 0, capacity: 20, slotNumber: index }));

    expect(selectLowStockSlots(many)).toHaveLength(50);
  });

  it("reports a null product name rather than dropping an unassigned slot", () => {
    const row = { ...candidate({ quantity: 0, capacity: 20 }), product: null };

    expect(selectLowStockSlots([row])[0]!.productName).toBeNull();
  });

  it("drops a slot whose machine has no site, matching how the alert log treats the same invariant", () => {
    const base = candidate({ quantity: 0, capacity: 20 });
    const row = { ...base, machine: { ...base.machine, site: null } };

    expect(selectLowStockSlots([row])).toEqual([]);
  });
});
