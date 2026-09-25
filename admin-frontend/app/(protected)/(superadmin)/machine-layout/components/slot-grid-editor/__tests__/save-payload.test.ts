import { describe, expect, it } from "vitest"

import { createSavePayload } from "../save-payload"
import { stepsPerVendError } from "../steps-per-vend"
import type { Layout } from "../types"
import { layoutFromSlots } from "../layout-math"

const layout: Layout = {
  columns: 2,
  rows: 1,
  stepsPerVend: 3200,
  slots: [
    { key: "a", id: "a", slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, quantity: 0, capacity: 10, pins: [{ number: 18 }] },
  ],
}

describe("createSavePayload", () => {
  // The backend requires it; a layout save without it is a 400.
  it("sends stepsPerVend beside the grid size", () => {
    const payload = createSavePayload("m1", layout)

    expect(payload.stepsPerVend).toBe(3200)
    expect(payload.columns).toBe(2)
    expect(payload.slots[0].pins).toEqual([{ number: 18 }])
  })
})

describe("stepsPerVendError", () => {
  it("accepts the bounds", () => {
    expect(stepsPerVendError("1")).toBeNull()
    expect(stepsPerVendError("65535")).toBeNull()
    expect(stepsPerVendError("6400")).toBeNull()
  })

  it("names the problem for blanks, fractions and out-of-range values", () => {
    expect(stepsPerVendError("")).toBe("Enter the number of steps")
    expect(stepsPerVendError("64.5")).toBe("Enter the number of steps")
    expect(stepsPerVendError("0")).toBe("Steps must be 1-65535")
    expect(stepsPerVendError("65536")).toBe("Steps must be 1-65535")
  })
})

describe("layoutFromSlots", () => {
  it("carries stepsPerVend for an empty and a populated layout", () => {
    expect(layoutFromSlots([], 3200).stepsPerVend).toBe(3200)
    expect(layoutFromSlots(layout.slots, 6400).stepsPerVend).toBe(6400)
  })
})
