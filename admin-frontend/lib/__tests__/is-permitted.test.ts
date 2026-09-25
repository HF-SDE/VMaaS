import { describe, expect, it } from "vitest"
import { PERMISSIONS } from "../../../shared/types/permissions"
import { isPermitted } from "@/lib/permissions"
import type { Session } from "@/lib/session-fetch"

const session: Session = {
  user: { id: "u1", name: "Kenni", email: "k@example.com" },
  activeTenantId: "t1",
  tenants: [{ id: "t1", name: "Tenant One" }],
  tenantInvites: [],
  permissions: [PERMISSIONS.PRODUCT_READ, PERMISSIONS.MACHINE_READ],
  subscription: { status: "active", trialEndsAt: null, currentPeriodEnd: null },
  isOwner: false,
}

describe("isPermitted", () => {
  it("defaults to requiring every permission", () => {
    expect(
      isPermitted(session, [PERMISSIONS.PRODUCT_READ, PERMISSIONS.MACHINE_READ])
    ).toBe(true)
    expect(
      isPermitted(session, [
        PERMISSIONS.PRODUCT_READ,
        PERMISSIONS.PRODUCT_WRITE,
      ])
    ).toBe(false)
  })

  it('requires only one permission in "any" mode', () => {
    expect(
      isPermitted(
        session,
        [PERMISSIONS.PRODUCT_READ, PERMISSIONS.PRODUCT_WRITE],
        "any"
      )
    ).toBe(true)
    expect(
      isPermitted(
        session,
        [PERMISSIONS.PRODUCT_WRITE, PERMISSIONS.SALE_REFUND],
        "any"
      )
    ).toBe(false)
  })

  /** An empty list states no requirement, so the gate must not block. Under
   *  "any" this is the one place the modes disagree: `some` over an empty list
   *  is false, which would silently hide children nobody meant to gate. */
  it("permits an empty permission list in both modes", () => {
    expect(isPermitted(session, [])).toBe(true)
    expect(isPermitted(session, [], "any")).toBe(true)
  })

  it("denies a null session", () => {
    expect(isPermitted(null, [PERMISSIONS.PRODUCT_READ])).toBe(false)
    expect(isPermitted(null, [PERMISSIONS.PRODUCT_READ], "any")).toBe(false)
  })

  /** A signed-out visitor still states no requirement here; the caller decides
   *  what a missing session means, not this predicate. */
  it("permits an empty list even for a null session", () => {
    expect(isPermitted(null, [])).toBe(true)
  })
})
