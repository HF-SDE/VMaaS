"use client"

import { useWs } from "@/hooks/use-ws"
import { handleConfigurationResult } from "@/lib/price-sync"

/**
 * Feeds the machines' `configuration.result` messages to the price-sync
 * tracker (lib/price-sync.ts). Mounted once in the protected layout, inside the
 * session the websocket needs, so a price saved in a dialog that has since
 * closed still gets its green or red toast.
 */
export function PriceSyncListener() {
  useWs((message) => {
    if (message.type === "configuration.result")
      handleConfigurationResult(message.body)
  })

  return null
}
