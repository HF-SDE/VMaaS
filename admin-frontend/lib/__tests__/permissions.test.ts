import { describe, expect, it } from "vitest"
import { PERMISSIONS } from "../../../shared/types/permissions"
import { hasPermission } from "@/lib/permissions"
import type { Session } from "@/lib/session"

const session: Session = {
  user: { id: "u1", name: "Kenni", email: "k@example.com" },
  activeTenantId: "t1",
  tenants: [{ id: "t1", name: "Tenant One" }],
  tenantInvites: [],
  permissions: [PERMISSIONS.MACHINE_READ],
  subscription: { status: "active", trialEndsAt: null, currentPeriodEnd: null },
  isOwner: false,
}

describe("hasPermission", () => {
  it("is true for a held permission", () => {
    expect(hasPermission(session, PERMISSIONS.MACHINE_READ)).toBe(true)
  })

  it("is false for a permission not held", () => {
    expect(hasPermission(session, PERMISSIONS.MACHINE_WRITE)).toBe(false)
  })

  it("is false for a null session", () => {
    expect(hasPermission(null, PERMISSIONS.MACHINE_READ)).toBe(false)
  })
})
