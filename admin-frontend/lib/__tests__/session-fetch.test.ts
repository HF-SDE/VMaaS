import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchSession } from "@/lib/session-fetch"

const payload = {
  user: { id: "u1", name: "Kenni", email: "k@example.com" },
  session: { activeTenantId: "t1" },
  tenants: [{ id: "t1", name: "Tenant One" }],
  tenantInvites: [
    { tenantId: "t2", tenantName: "Tenant Two", token: "inv1", roleName: "Operator" },
  ],
  permissions: ["machine:read"],
}

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

/** Queues one response per call, so a retry can be given a different outcome. */
function mockFetchSequence(...responses: [status: number, body?: unknown][]) {
  let call = 0
  return vi.fn(async () => {
    const [status, body = {}] = responses[Math.min(call++, responses.length - 1)]!
    return new Response(JSON.stringify(body), { status })
  })
}

/** The retry sleeps, so drive the backoff rather than waiting it out. */
function settle<T>(promise: Promise<T>): Promise<T> {
  // Claim the rejection now: it can land while the timers run, and an
  // unhandled one there fails the run rather than the assertion below.
  promise.catch(() => {})
  return vi.runAllTimersAsync().then(() => promise)
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("fetchSession", () => {
  it("returns null when no auth cookies are present", async () => {
    const spy = mockFetch(200, payload)
    vi.stubGlobal("fetch", spy)

    expect(await fetchSession("")).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it("returns null on 401", async () => {
    vi.stubGlobal("fetch", mockFetch(401))
    expect(await fetchSession("better-auth.session_token=abc")).toBeNull()
  })

  it("throws on a backend failure rather than reporting signed-out", async () => {
    vi.stubGlobal("fetch", mockFetch(500))
    await expect(settle(fetchSession("better-auth.session_token=abc"))).rejects.toThrow(
      /500/
    )
  })

  it("maps the enriched payload", async () => {
    vi.stubGlobal("fetch", mockFetch(200, payload))
    const session = await fetchSession("better-auth.session_token=abc")

    expect(session).toEqual({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      activeTenantId: "t1",
      tenants: [{ id: "t1", name: "Tenant One" }],
      tenantInvites: [
        {
          tenantId: "t2",
          tenantName: "Tenant Two",
          token: "inv1",
          roleName: "Operator",
        },
      ],
      permissions: ["machine:read"],
      // Absent from this payload. `null` means "no active tenant, or the
      // lookup failed" — deliberately not a billing status, so the access
      // resolver can tell an outage apart from an unpaid organization.
      subscription: null,
      isOwner: false,
    })
  })

  it("treats a null session body as signed out", async () => {
    vi.stubGlobal("fetch", mockFetch(200, null))
    expect(await fetchSession("better-auth.session_token=abc")).toBeNull()
  })

  it("defaults a missing active tenant to null", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { ...payload, session: {} }))
    const session = await fetchSession("better-auth.session_token=abc")
    expect(session?.activeTenantId).toBeNull()
  })
})

describe("fetchSession transient failures", () => {
  it("retries a 429 and returns the session when the retry succeeds", async () => {
    const spy = mockFetchSequence([429], [200, payload])
    vi.stubGlobal("fetch", spy)

    const session = await settle(fetchSession("better-auth.session_token=abc"))

    expect(spy).toHaveBeenCalledTimes(2)
    expect(session?.user.id).toBe("u1")
  })

  it("retries a 503 and returns the session when the retry succeeds", async () => {
    const spy = mockFetchSequence([503], [200, payload])
    vi.stubGlobal("fetch", spy)

    const session = await settle(fetchSession("better-auth.session_token=abc"))

    expect(spy).toHaveBeenCalledTimes(2)
    expect(session?.user.id).toBe("u1")
  })

  it("gives up after one retry so a render cannot hang on a long outage", async () => {
    const spy = mockFetch(429)
    vi.stubGlobal("fetch", spy)

    await expect(settle(fetchSession("better-auth.session_token=abc"))).rejects.toThrow(
      /429/
    )
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("retries a network error and returns the session when the retry succeeds", async () => {
    let call = 0
    const spy = vi.fn(async () => {
      if (call++ === 0) throw new TypeError("fetch failed")
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    vi.stubGlobal("fetch", spy)

    const session = await settle(fetchSession("better-auth.session_token=abc"))

    expect(spy).toHaveBeenCalledTimes(2)
    expect(session?.user.id).toBe("u1")
  })

  it("does not retry a 401 — signed out is a settled answer", async () => {
    const spy = mockFetch(401)
    vi.stubGlobal("fetch", spy)

    expect(await settle(fetchSession("better-auth.session_token=abc"))).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("does not retry a 400 — a malformed request will fail identically", async () => {
    const spy = mockFetch(400)
    vi.stubGlobal("fetch", spy)

    await expect(settle(fetchSession("better-auth.session_token=abc"))).rejects.toThrow(
      /400/
    )
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
