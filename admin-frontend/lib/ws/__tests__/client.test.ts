import { afterEach, describe, expect, it, vi } from "vitest"

import { backoffFor, createWsClient, socketUrl } from "@/lib/ws/client"

const TENANT = "11111111-1111-4111-8111-111111111111"

/** Enough of a WebSocket for the client: it only assigns handlers and calls close(). */
class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn(() => this.onclose?.())

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

/** Collects the sockets the client opens and lets a test run the pending backoff timer. */
function harness() {
  const sockets: FakeSocket[] = []
  const timers: Array<() => void> = []
  const delays: number[] = []

  return {
    sockets,
    delays,
    runTimer: () => timers.shift()?.(),
    pendingTimers: () => timers.length,
    options: {
      createSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      setTimer: (fn: () => void, ms: number) => {
        timers.push(fn)
        delays.push(ms)
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => timers.shift(),
    },
  }
}

afterEach(() => vi.restoreAllMocks())

describe("socketUrl", () => {
  it("targets /api/ws with the tenant as a query param", () => {
    expect(socketUrl(TENANT)).toBe(
      `ws://localhost:5000/api/ws?tenantId=${TENANT}`
    )
  })

  it("omits the tenant so the backend falls back to the session's active one", () => {
    expect(socketUrl(null)).toBe("ws://localhost:5000/api/ws")
  })
})

describe("backoffFor", () => {
  it("widens the delay with each attempt", () => {
    expect(backoffFor(0)).toBeLessThan(backoffFor(1))
    expect(backoffFor(1)).toBeLessThan(backoffFor(2))
  })

  it("caps instead of growing without bound", () => {
    expect(backoffFor(99)).toBe(backoffFor(4))
  })
})

describe("createWsClient", () => {
  it("delivers a parsed message to the handler", () => {
    const onMessage = vi.fn()
    const h = harness()
    createWsClient({ tenantId: TENANT, onMessage, ...h.options })

    h.sockets[0].emit({ type: "connected", tenantId: TENANT })

    expect(onMessage).toHaveBeenCalledWith({
      type: "connected",
      tenantId: TENANT,
    })
  })

  it("ignores an event type it does not know rather than throwing", () => {
    const onMessage = vi.fn()
    const h = harness()
    createWsClient({ tenantId: TENANT, onMessage, ...h.options })

    expect(() =>
      h.sockets[0].emit({ type: "from.a.newer.backend" })
    ).not.toThrow()
    expect(onMessage).not.toHaveBeenCalled()
  })

  it("reconnects after an unexpected close", () => {
    const h = harness()
    createWsClient({ tenantId: TENANT, onMessage: vi.fn(), ...h.options })

    h.sockets[0].onclose?.()
    h.runTimer()

    expect(h.sockets).toHaveLength(2)
  })

  it("widens the delay while the socket stays down", () => {
    const h = harness()
    createWsClient({ tenantId: TENANT, onMessage: vi.fn(), ...h.options })

    h.sockets[0].onclose?.()
    h.runTimer()
    h.sockets[1].onclose?.()

    expect(h.delays).toEqual([backoffFor(0), backoffFor(1)])
  })

  it("resets the backoff once a reconnect succeeds", () => {
    const h = harness()
    createWsClient({ tenantId: TENANT, onMessage: vi.fn(), ...h.options })

    h.sockets[0].onclose?.()
    h.runTimer()
    h.sockets[1].onopen?.()
    h.sockets[1].onclose?.()

    // The second drop starts from the shortest delay again, not from where the first left off.
    expect(h.delays).toEqual([backoffFor(0), backoffFor(0)])
  })

  it("stops reconnecting after teardown", () => {
    const h = harness()
    const stop = createWsClient({
      tenantId: TENANT,
      onMessage: vi.fn(),
      ...h.options,
    })

    stop()

    expect(h.sockets[0].close).toHaveBeenCalled()
    expect(h.pendingTimers()).toBe(0)
    expect(h.sockets).toHaveLength(1)
  })
})
