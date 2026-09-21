"use client"

import { useEffect, useRef } from "react"

import { useSession } from "@/lib/session-provider"
import { createWsClient } from "@/lib/ws/client"
import type { WsServerMessage } from "@vmaas/shared/schemas"

/**
 * Subscribes to the backend's push events for the session's active tenant.
 * The socket is opened once per tenant and torn down on unmount or on a tenant
 * switch; reconnects are handled inside the client.
 *
 * @example
 * useWs((message) => {
 *   if (message.type === "alert.created") refreshAlerts()
 * })
 */
export function useWs(onMessage: (message: WsServerMessage) => void) {
  const { activeTenantId } = useSession()

  // Kept in a ref so a caller passing an inline arrow does not reopen the
  // socket on every render — only the tenant should do that.
  const handler = useRef(onMessage)
  useEffect(() => {
    handler.current = onMessage
  }, [onMessage])

  useEffect(() => {
    if (!activeTenantId) return

    return createWsClient({
      tenantId: activeTenantId,
      onMessage: (message) => handler.current(message),
    })
  }, [activeTenantId])
}
