import { describe, expect, it } from "vitest"

import { canConfirmCount, slotPatchBody } from "@/lib/slot-patch"

const loaded = { quantity: 10, capacity: 12, price: 15 }

describe("slotPatchBody", () => {
  // A quantity the dialog loaded earlier may be stale by now (a sale was
  // booked since). Resending it would count as a correction and reset the
  // slot's count time, so the machine would sell an item that is gone.
  it("leaves an unchanged quantity out", () => {
    expect(slotPatchBody({ ...loaded, price: 20 }, loaded, "p-1")).toEqual({
      capacity: 12,
      price: 20,
      productId: "p-1",
    })
  })

  it("sends the quantity when the user changed it", () => {
    expect(slotPatchBody({ ...loaded, quantity: 8 }, loaded, "p-1")).toEqual({
      quantity: 8,
      capacity: 12,
      price: 15,
      productId: "p-1",
    })
  })
})

describe("canConfirmCount", () => {
  // Confirm count confirms the stored number; a typed but unsaved one would
  // be ignored while the user believes it was counted.
  it("is allowed only while the quantity field still shows the loaded number", () => {
    expect(canConfirmCount(10, 10)).toBe(true)
    expect(canConfirmCount(8, 10)).toBe(false)
  })
})
