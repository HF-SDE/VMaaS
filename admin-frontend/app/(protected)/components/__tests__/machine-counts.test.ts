import { describe, expect, it } from "vitest"

import { machineCounts } from "../machine-counts"

/**
 * `never_seen` exists because `machine_status` defaults to a value before any
 * broker event has ever landed. The KPI row is where that distinction earns its
 * keep: a machine nobody has set up yet is not a machine that needs service,
 * and counting it as one would send a technician to a crate in a warehouse.
 */

type MachineRow = NonNullable<Parameters<typeof machineCounts>[0]>[number]

const machines = (...statuses: string[]) => statuses.map((status) => ({ status }) as MachineRow)

describe("machineCounts", () => {
  it("counts never_seen apart from offline", () => {
    const counts = machineCounts(machines("never_seen", "never_seen", "offline"))

    expect(counts.neverSeen).toBe(2)
    expect(counts.offline).toBe(1)
  })

  it("leaves never_seen out of needsService", () => {
    const counts = machineCounts(machines("never_seen", "offline", "error"))

    expect(counts.needsService).toBe(2)
  })

  it("counts only genuinely connected machines as online", () => {
    const counts = machineCounts(machines("online", "never_seen", "offline"))

    expect(counts.online).toBe(1)
  })

  it("reports zeroes rather than throwing when the machines could not be loaded", () => {
    const counts = machineCounts(null)

    expect(counts).toMatchObject({ online: 0, offline: 0, error: 0, neverSeen: 0, needsService: 0 })
  })
})
