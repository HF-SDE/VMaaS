import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock("sonner", () => ({ toast }))

import {
  PRICE_SYNC_TIMEOUT_MS,
  handleConfigurationResult,
  priceSyncNotices,
  trackPriceSync,
} from "@/lib/price-sync"
import type { PricePublishOutcome } from "@vmaas/shared/types/configuration"

const outcome = (over: Partial<PricePublishOutcome>): PricePublishOutcome => ({
  machineId: "m-1",
  machineName: "Lobby",
  status: "sent",
  commandId: "cfg-1",
  ...over,
})

describe("priceSyncNotices", () => {
  it("warns once about an offline machine", () => {
    expect(priceSyncNotices([outcome({ status: "offline" })])).toEqual([
      {
        kind: "warning",
        message:
          "Lobby is offline. The price will be updated the next time it comes online.",
      },
    ])
  })

  it("groups several offline machines into one warning", () => {
    const notices = priceSyncNotices([
      outcome({ machineId: "a", status: "offline" }),
      outcome({ machineId: "b", status: "offline" }),
    ])
    expect(notices).toEqual([
      {
        kind: "warning",
        message:
          "2 machines are offline. Their prices will be updated the next time they come online.",
      },
    ])
  })

  it("shows a loading notice per machine the price was sent to", () => {
    expect(priceSyncNotices([outcome({})])).toEqual([
      {
        kind: "loading",
        message: "Sending the new price to Lobby…",
        commandId: "cfg-1",
        machineName: "Lobby",
      },
    ])
  })

  it("says nothing for unchanged or never-published machines", () => {
    expect(
      priceSyncNotices([
        outcome({ status: "unchanged", commandId: null }),
        outcome({ status: "not_published", commandId: null }),
      ])
    ).toEqual([])
  })
})

describe("trackPriceSync", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.values(toast).forEach((fn) => fn.mockReset())
  })
  afterEach(() => vi.useRealTimers())

  it("turns the loading toast green when the machine applies the price", () => {
    trackPriceSync([outcome({})])
    expect(toast.loading).toHaveBeenCalledWith(
      "Sending the new price to Lobby…",
      { id: "cfg-1" }
    )

    handleConfigurationResult({
      commandId: "cfg-1",
      machineId: "m-1",
      status: "completed",
      detail: null,
    })

    expect(toast.success).toHaveBeenCalledWith(
      "The new price is live on Lobby.",
      { id: "cfg-1" }
    )
    vi.advanceTimersByTime(PRICE_SYNC_TIMEOUT_MS)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("turns it red when the machine reports a failure", () => {
    trackPriceSync([outcome({})])
    handleConfigurationResult({
      commandId: "cfg-1",
      machineId: "m-1",
      status: "failed",
      detail: "x",
    })

    expect(toast.error).toHaveBeenCalledWith(
      "The new price did not reach Lobby. See Alerts.",
      { id: "cfg-1" }
    )
  })

  it("turns it red when the machine does not answer in time", () => {
    trackPriceSync([outcome({})])
    vi.advanceTimersByTime(PRICE_SYNC_TIMEOUT_MS)

    expect(toast.error).toHaveBeenCalledWith(
      "The new price did not reach Lobby. See Alerts.",
      { id: "cfg-1" }
    )
    // A late answer after the timeout changes nothing.
    handleConfigurationResult({
      commandId: "cfg-1",
      machineId: "m-1",
      status: "completed",
      detail: null,
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("ignores results for commands it is not tracking", () => {
    handleConfigurationResult({
      commandId: "cfg-other",
      machineId: "m-1",
      status: "completed",
      detail: null,
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows the offline warning as a warning toast", () => {
    trackPriceSync([outcome({ status: "offline" })])
    expect(toast.warning).toHaveBeenCalledWith(
      "Lobby is offline. The price will be updated the next time it comes online."
    )
  })
})
