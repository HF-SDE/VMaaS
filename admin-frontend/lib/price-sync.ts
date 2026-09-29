import { toast } from "sonner"

import type { WsConfigurationResultMessage } from "@vmaas/shared/schemas"
import type { PricePublishOutcome } from "@vmaas/shared/types/configuration"

/**
 * Tells the user whether a price they changed reached the machine.
 *
 * The slot and product endpoints answer with `publish`, one outcome per
 * machine. An offline machine gets a warning: it picks the price up when it
 * next connects. For an online one a loading toast waits for the machine's
 * `configuration.result` over the websocket and turns green or red; no answer
 * within PRICE_SYNC_TIMEOUT_MS is red too. The backend raises the matching
 * alert on its own, so this is only what the user sees now.
 *
 * Module-level on purpose: the form that saved the price closes straight away,
 * so the tracking has to outlive it. PriceSyncListener feeds it the results.
 */

/** Matches the backend's PRICE_RESULT_TIMEOUT_MS. */
export const PRICE_SYNC_TIMEOUT_MS = 60_000

export type PriceSyncNotice =
  | { kind: "warning"; message: string }
  | { kind: "loading"; message: string; commandId: string; machineName: string }

export function priceSyncNotices(
  outcomes: PricePublishOutcome[]
): PriceSyncNotice[] {
  const notices: PriceSyncNotice[] = []

  const offline = outcomes.filter((o) => o.status === "offline")
  if (offline.length === 1) {
    notices.push({
      kind: "warning",
      message: `${offline[0].machineName} is offline. The price will be updated the next time it comes online.`,
    })
  } else if (offline.length > 1) {
    notices.push({
      kind: "warning",
      message: `${offline.length} machines are offline. Their prices will be updated the next time they come online.`,
    })
  }

  for (const o of outcomes) {
    if (o.status === "sent" && o.commandId) {
      notices.push({
        kind: "loading",
        message: `Sending the new price to ${o.machineName}…`,
        commandId: o.commandId,
        machineName: o.machineName,
      })
    }
  }

  return notices
}

const pending = new Map<string,{ machineName: string; timer: ReturnType<typeof setTimeout> }>()

function failed(commandId: string, machineName: string) {
  toast.error(`The new price did not reach ${machineName}. See Alerts.`, {
    id: commandId,
  })
}

/** Show the notices for a save's `publish` outcomes and start waiting for the results. */
export function trackPriceSync(outcomes: PricePublishOutcome[] | undefined) {
  for (const notice of priceSyncNotices(outcomes ?? [])) {
    if (notice.kind === "warning") {
      toast.warning(notice.message)
      continue
    }

    const { commandId, machineName } = notice
    toast.loading(notice.message, { id: commandId })
    const timer = setTimeout(() => {
      pending.delete(commandId)
      failed(commandId, machineName)
    }, PRICE_SYNC_TIMEOUT_MS)
    pending.set(commandId, { machineName, timer })
  }
}

/** A machine's answer, from the websocket. Results for untracked commands are ignored. */
export function handleConfigurationResult(
  body: WsConfigurationResultMessage["body"]
) {
  const entry = pending.get(body.commandId)
  if (!entry) return

  clearTimeout(entry.timer)
  pending.delete(body.commandId)

  if (body.status === "completed") {
    toast.success(`The new price is live on ${entry.machineName}.`, {
      id: body.commandId,
    })
  } else {
    failed(body.commandId, entry.machineName)
  }
}
