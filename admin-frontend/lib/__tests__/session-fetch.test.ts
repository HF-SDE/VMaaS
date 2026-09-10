import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchSession } from "@/lib/session-fetch"

const payload = {
  user: { id: "u1", name: "Kenni", email: "k@example.com" },
  session: { activeTenantId: "t1" },
  tenants: [{ id: "t1", name: "Tenant One" }],
  permissions: ["machine:read"],
}

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

afterEach(() => vi.unstubAllGlobals())

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
    await expect(fetchSession("better-auth.session_token=abc")).rejects.toThrow(/500/)
  })

  it("maps the enriched payload", async () => {
    vi.stubGlobal("fetch", mockFetch(200, payload))
    const session = await fetchSession("better-auth.session_token=abc")

    expect(session).toEqual({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      activeTenantId: "t1",
      tenants: [{ id: "t1", name: "Tenant One" }],
      permissions: ["machine:read"],
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
