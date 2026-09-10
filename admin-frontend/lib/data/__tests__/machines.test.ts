import { afterEach, describe, expect, it, vi } from "vitest"

import { getMachines } from "@/lib/data/machines"

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [{ name: "better-auth.session_token", value: "abc" }],
  }),
}))

afterEach(() => vi.unstubAllGlobals())

describe("getMachines", () => {
  it("reads the tenant's machines from the session-authenticated route", async () => {
    const machines = [{ id: "m1", name: "Kantine 1", status: "online" }]
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(machines), { status: 200 })
    )
    vi.stubGlobal("fetch", spy)

    await expect(getMachines("t1")).resolves.toEqual(machines)

    expect(spy.mock.calls[0]![0]).toBe("http://localhost:5000/api/machines")
    const headers = new Headers(spy.mock.calls[0]![1]!.headers)
    expect(headers.get("x-tenant-id")).toBe("t1")
  })

  it("propagates a permission failure instead of rendering an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 }))
    )

    await expect(getMachines("t1")).rejects.toThrow(/403/)
  })
})
