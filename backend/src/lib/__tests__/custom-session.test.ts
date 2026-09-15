import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rbac")>()),
  listTenantsForUser: vi.fn(async () => [{ id: "t1", name: "Tenant One" }]),
  getUserPermissions: vi.fn(async () => new Set(["machine:read"])),
}))

import { enrichSession } from "@/lib/auth"

describe("enrichSession", () => {
  it("adds the user's tenants and permissions", async () => {
    const result = await enrichSession({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      session: { activeTenantId: "t1" },
    } as never)

    expect(result.tenants).toEqual([{ id: "t1", name: "Tenant One" }])
    expect(result.permissions).toEqual(["machine:read"])
  })

  it("passes a null active tenant through to the permission lookup", async () => {
    const { getUserPermissions } = await import("@/lib/rbac")
    await enrichSession({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      session: {},
    } as never)

    expect(getUserPermissions).toHaveBeenCalledWith("u1", null)
  })
})
