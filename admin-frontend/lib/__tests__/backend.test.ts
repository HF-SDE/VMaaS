import { afterEach, describe, expect, it, vi } from "vitest"

import {
  authCookieHeader,
  backendFetch,
  backendRequest,
  BackendError,
} from "@/lib/backend"

const cookieJar: { name: string; value: string }[] = []

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => cookieJar }),
}))

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(status === 204 ? null : JSON.stringify(body), { status })
  )
}

function lastInit(spy: ReturnType<typeof mockFetch>): RequestInit {
  return spy.mock.calls[0]![1]!
}

afterEach(() => vi.unstubAllGlobals())

describe("authCookieHeader", () => {
  it("forwards only better-auth cookies", () => {
    const header = authCookieHeader([
      { name: "better-auth.session_token", value: "abc" },
      { name: "ph_analytics", value: "nope" },
      { name: "better-auth.session_data", value: "def" },
    ])

    expect(header).toBe(
      "better-auth.session_token=abc; better-auth.session_data=def"
    )
  })

  it("forwards the __Secure- and __Host- prefixed variants", () => {
    const header = authCookieHeader([
      { name: "__Secure-better-auth.session_token", value: "abc" },
      { name: "__Host-better-auth.session_data", value: "def" },
    ])

    expect(header).toBe(
      "__Secure-better-auth.session_token=abc; __Host-better-auth.session_data=def"
    )
  })

  it("returns an empty string when no auth cookies are present", () => {
    expect(authCookieHeader([{ name: "theme", value: "dark" }])).toBe("")
  })
})

describe("backendRequest", () => {
  const cookieHeader = "better-auth.session_token=abc"

  it("calls the backend with the forwarded cookie and returns the parsed body", async () => {
    const spy = mockFetch(200, [{ id: "m1" }])
    vi.stubGlobal("fetch", spy)

    const body = await backendRequest("/api/machines", { cookieHeader })

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![0]).toBe("http://localhost:5000/api/machines")
    expect(new Headers(lastInit(spy).headers).get("cookie")).toBe(cookieHeader)
    expect(body).toEqual([{ id: "m1" }])
  })

  it("sends the tenant as x-tenant-id so the backend does not fall back to the active tenant", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/machines", { cookieHeader, tenantId: "t1" })

    expect(new Headers(lastInit(spy).headers).get("x-tenant-id")).toBe("t1")
  })

  it("omits x-tenant-id when no tenant is given", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/auth/get-session", { cookieHeader })

    expect(new Headers(lastInit(spy).headers).has("x-tenant-id")).toBe(false)
  })

  it("never caches, because the response is scoped to one user's cookie", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/machines", { cookieHeader })

    expect(lastInit(spy).cache).toBe("no-store")
  })

  it("JSON-encodes a body and sets the content type", async () => {
    const spy = mockFetch(201)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/machines", {
      cookieHeader,
      method: "POST",
      json: { name: "Kantine 1" },
    })

    const init = lastInit(spy)
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ name: "Kantine 1" }))
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json"
    )
  })

  it("appends query params to the path", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/products/paginated", {
      cookieHeader,
      query: { page: 2, pageSize: 25, sortOrder: "asc" },
    })

    expect(spy.mock.calls[0]![0]).toBe(
      "http://localhost:5000/api/products/paginated?page=2&pageSize=25&sortOrder=asc"
    )
  })

  it("drops nullish and empty params so an unset filter is not sent as an empty one", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/products/paginated", {
      cookieHeader,
      query: { page: 0, search: "", sortBy: undefined, sortOrder: null },
    })

    expect(spy.mock.calls[0]![0]).toBe(
      "http://localhost:5000/api/products/paginated?page=0"
    )
  })

  it("leaves the path untouched when every param is dropped", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/products", {
      cookieHeader,
      query: { search: undefined },
    })

    expect(spy.mock.calls[0]![0]).toBe("http://localhost:5000/api/products")
  })

  it("escapes query values rather than splicing them into the URL raw", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await backendRequest("/api/products/paginated", {
      cookieHeader,
      query: { search: "kaffe & te" },
    })

    expect(spy.mock.calls[0]![0]).toBe(
      "http://localhost:5000/api/products/paginated?search=kaffe+%26+te"
    )
  })

  it("refuses to call the backend without a cookie rather than sending an anonymous request", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await expect(
      backendRequest("/api/machines", { cookieHeader: "" })
    ).rejects.toThrow(BackendError)
    expect(spy).not.toHaveBeenCalled()
  })

  it("throws a BackendError carrying the status so callers can map 403", async () => {
    vi.stubGlobal("fetch", mockFetch(403, { error: "Missing permission" }))

    const error = await backendRequest("/api/machines", {
      cookieHeader,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BackendError)
    expect((error as BackendError).status).toBe(403)
    expect((error as BackendError).message).toMatch(/\/api\/machines/)
    expect((error as BackendError).message).toMatch(/403/)
  })

  it("returns undefined for a 204, which has no body to parse", async () => {
    vi.stubGlobal("fetch", mockFetch(204))

    await expect(
      backendRequest("/api/auth/tenant/switch", {
        cookieHeader,
        method: "POST",
      })
    ).resolves.toBeUndefined()
  })
})

describe("backendFetch", () => {
  afterEach(() => {
    cookieJar.length = 0
  })

  it("forwards the request's auth cookies without the caller handling them", async () => {
    const spy = mockFetch(200, [])
    vi.stubGlobal("fetch", spy)
    cookieJar.push(
      { name: "better-auth.session_token", value: "abc" },
      { name: "theme", value: "dark" }
    )

    await backendFetch("/api/machines", { tenantId: "t1" })

    const headers = new Headers(lastInit(spy).headers)
    expect(headers.get("cookie")).toBe("better-auth.session_token=abc")
    expect(headers.get("x-tenant-id")).toBe("t1")
  })

  it("fails without calling the backend when the request has no auth cookie", async () => {
    const spy = mockFetch(200)
    vi.stubGlobal("fetch", spy)

    await expect(backendFetch("/api/machines")).rejects.toThrow(BackendError)
    expect(spy).not.toHaveBeenCalled()
  })
})
