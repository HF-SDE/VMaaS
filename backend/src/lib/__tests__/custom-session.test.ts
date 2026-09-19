import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rbac")>()),
  listTenantsForUser: vi.fn(async () => [{ id: "t1", name: "Tenant One" }]),
  getUserPermissions: vi.fn(async () => new Set(["machine:read"])),
  getUserInvites: vi.fn(async () => []),
  isTenantOwner: vi.fn(async () => true),
}))

vi.mock("@/api/services/subscriptions.service", () => ({
  getTenantSubscription: vi.fn(async () => [
    null,
    { status: "active", trialEndsAt: null, currentPeriodEnd: new Date("2027-01-01") },
  ]),
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

  it("looks invitations up by email, not by user id", async () => {
    const { getUserInvites } = await import("@/lib/rbac")
    await enrichSession({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      session: { activeTenantId: "t1" },
    } as never)

    expect(getUserInvites).toHaveBeenCalledWith("k@example.com")
  })

  it("reports the active tenant's subscription", async () => {
    const result = await enrichSession({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      session: { activeTenantId: "t1" },
    } as never)

    expect(result.subscription).toMatchObject({ status: "active" })
    expect(result.isOwner).toBe(true)
  })

  // The session outlives the membership that justified its active tenant, so a
  // removed member must not be routed into a tenant the backend will refuse.
  it("drops an active tenant the user is no longer a member of", async () => {
    const result = await enrichSession({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      session: { activeTenantId: "gone" },
    } as never)

    expect(result.session.activeTenantId).toBeNull()
    expect(result.subscription).toBeNull()
    expect(result.isOwner).toBe(false)
  })

  it("reports an unknown subscription as null rather than as missing", async () => {
    const { getTenantSubscription } = await import("@/api/services/subscriptions.service")
    vi.mocked(getTenantSubscription).mockResolvedValueOnce([
      { reason: "UNKNOWN_ERROR", message: "boom" },
      null,
    ] as never)

    const result = await enrichSession({
      user: { id: "u1", name: "Kenni", email: "k@example.com" },
      session: { activeTenantId: "t1" },
    } as never)

    expect(result.subscription).toBeNull()
  })
})
