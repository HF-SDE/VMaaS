import {
  wsServerMessageSchema,
  type WsServerMessage,
} from "@vmaas/shared/schemas"

import { config } from "../config"

/** Reconnect delays in ms, then the last one repeats for as long as the socket stays down. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

/** `WebSocket.CONNECTING`, spelled out so it does not depend on the global existing (tests, SSR). */
const CONNECTING = 0

export function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
}

/**
 * The backend serves the socket off the same origin and port as the REST API,
 * so the URL is the configured backend URL with the scheme swapped — `https`
 * has to become `wss` or the browser refuses the handshake on a secure page.
 */
export function socketUrl(tenantId?: string | null): string {
  const url = new URL("/api/ws", config.NEXT_PUBLIC_BACKEND_URL)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  // Omitted for the session's active tenant, which is what the backend falls back to.
  if (tenantId) url.searchParams.set("tenantId", tenantId)
  return url.toString()
}

export type WsClientOptions = {
  tenantId?: string | null
  onMessage: (message: WsServerMessage) => void
  /** Injected by the tests; defaults to the browser's own constructor. */
  createSocket?: (url: string) => WebSocket
  /** Injected by the tests so backoff does not mean a real wait. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * Opens the socket and keeps it open: a close that was not asked for schedules
 * a reconnect on a widening backoff, and a successful open resets it. Returns
 * the teardown, which stops reconnecting as well as closing the current socket
 * — without that flag the close handler would immediately dial again.
 */
export function createWsClient({
  tenantId,
  onMessage,
  createSocket = (url) => new WebSocket(url),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: WsClientOptions): () => void {
  let socket: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let stopped = false

  function connect() {
    if (stopped) return

    socket = createSocket(socketUrl(tenantId))

    socket.onopen = () => {
      attempt = 0
    }

    socket.onmessage = (event: MessageEvent) => {
      const parsed = wsServerMessageSchema.safeParse(
        JSON.parse(String(event.data))
      )
      // An event this build does not know about is ignored rather than thrown:
      // a newer backend must not break an older tab.
      if (parsed.success) onMessage(parsed.data)
    }

    // `onerror` is always followed by `onclose`, so reconnecting is handled in one place.
    socket.onclose = () => {
      socket = null
      if (stopped) return
      retry = setTimer(connect, backoffFor(attempt))
      attempt += 1
    }
  }

  connect()

  return () => {
    stopped = true
    if (retry) clearTimer(retry)

    const current = socket
    socket = null
    if (!current) return

    // Closing a socket mid-handshake makes the browser log "closed before the
    // connection is established" — which StrictMode's mount/unmount/mount does
    // on every dev load. Let the handshake finish, then close it silently.
    if (current.readyState === CONNECTING) {
      current.onmessage = null
      current.onopen = () => current.close()
      return
    }
    current.close()
  }
}
