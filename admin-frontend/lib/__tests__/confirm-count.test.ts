import { beforeEach, describe, expect, it, vi } from "vitest"

const { fetchData, trackPriceSync, toast } = vi.hoisted(() => ({
  fetchData: vi.fn(),
  trackPriceSync: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/data/data-fetch", () => ({ fetchData }))
vi.mock("@/lib/price-sync", () => ({ trackPriceSync }))
vi.mock("sonner", () => ({ toast }))

import { confirmSlotCount } from "@/lib/confirm-count"

beforeEach(() => {
  fetchData.mockReset()
  trackPriceSync.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

describe("confirmSlotCount", () => {
  it("posts to the slot's confirm-count endpoint and hands publish to the sync toasts", async () => {
    const publish = [
      {
        machineId: "m-1",
        machineName: "Lobby",
        status: "sent",
        commandId: "cfg-1",
      },
    ]
    fetchData.mockResolvedValue([null, { id: "slot-1", publish }])

    const ok = await confirmSlotCount("slot-1")

    expect(ok).toBe(true)
    expect(fetchData).toHaveBeenCalledWith("/api/slots/slot-1/confirm-count", {
      method: "POST",
    })
    expect(toast.success).toHaveBeenCalledWith("Count confirmed.")
    expect(trackPriceSync).toHaveBeenCalledWith(publish)
  })

  it("shows an error and tracks nothing when the request fails", async () => {
    fetchData.mockResolvedValue([{ status: 404, reason: "NOT_FOUND" }, null])

    const ok = await confirmSlotCount("slot-x")

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(trackPriceSync).not.toHaveBeenCalled()
  })
})
