import { describe, expect, it } from "vitest"
import { ACCESS_REDIRECTS, resolveUserAccess } from "@/lib/access"
import type { Session } from "@/lib/session"
import type { SubscriptionStatus } from "@vmaas/shared/types"

function session(overrides: Partial<Session> = {}): Session {
  return {
    user: { id: "u1", name: "Kenni", email: "k@example.com" },
    activeTenantId: "t1",
    tenants: [{ id: "t1", name: "Tenant One" }],
    tenantInvites: [],
    permissions: [],
    subscription: {
      status: "active",
      trialEndsAt: null,
      currentPeriodEnd: null,
    },
    isOwner: false,
    ...overrides,
  }
}

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString()

describe("resolveUserAccess", () => {
  it("requires auth with no session", () => {
    const access = resolveUserAccess(null)

    expect(access.accessState).toBe("AUTH_REQUIRED")
    expect(access.authenticated).toBe(false)
  })

  it("is READY for an active subscription on an active tenant", () => {
    expect(resolveUserAccess(session()).accessState).toBe("READY")
  })

  it("sends a user with no memberships to onboarding", () => {
    const access = resolveUserAccess(
      session({ activeTenantId: null, tenants: [] })
    )

    expect(access.accessState).toBe("NO_ORGANIZATION")
  })

  it("asks a user with several memberships to choose", () => {
    const access = resolveUserAccess(
      session({
        activeTenantId: null,
        tenants: [
          { id: "t1", name: "One" },
          { id: "t2", name: "Two" },
        ],
      })
    )

    expect(access.accessState).toBe("SELECT_ORGANIZATION")
  })

  // The session outlives the membership: the user was removed from the tenant
  // while signed in. Routing them into it would mean every API call 403s.
  it("ignores an active tenant the user no longer belongs to", () => {
    const access = resolveUserAccess(
      session({ activeTenantId: "gone", tenants: [{ id: "t1", name: "One" }] })
    )

    expect(access.accessState).toBe("SELECT_ORGANIZATION")
    expect(access.activeTenantId).toBeNull()
  })

  describe("billing", () => {
    it.each([
      "pending",
      "past_due",
      "canceled",
      "incomplete",
      "unpaid",
    ] as const)(
      "sends an owner of a %s organization to the paywall",
      (status: SubscriptionStatus) => {
        const access = resolveUserAccess(
          session({
            isOwner: true,
            subscription: {
              status,
              trialEndsAt: null,
              currentPeriodEnd: null,
            },
          })
        )

        expect(access.accessState).toBe("BILLING_REQUIRED")
      }
    )

    // Same billing state, different destination: a member cannot fix it, so
    // offering them checkout would be a dead end at best and a hole at worst.
    it("sends a member of an unpaid organization to the locked page", () => {
      const access = resolveUserAccess(
        session({
          isOwner: false,
          subscription: {
            status: "past_due",
            trialEndsAt: null,
            currentPeriodEnd: null,
          },
        })
      )

      expect(access.accessState).toBe("BILLING_LOCKED")
    })

    it("lets a live trial through", () => {
      const access = resolveUserAccess(
        session({
          subscription: {
            status: "trialing",
            trialEndsAt: inDays(3),
            currentPeriodEnd: null,
          },
        })
      )

      expect(access.accessState).toBe("READY")
    })

    it("treats an elapsed trial as unpaid", () => {
      const access = resolveUserAccess(
        session({
          isOwner: true,
          subscription: {
            status: "trialing",
            trialEndsAt: inDays(-1),
            currentPeriodEnd: null,
          },
        })
      )

      expect(access.accessState).toBe("BILLING_REQUIRED")
    })

    // A failed lookup must not read as "not subscribed", which would paywall a
    // paying customer because the database hiccupped.
    it("reports an unknown subscription separately from an unpaid one", () => {
      const access = resolveUserAccess(session({ subscription: null }))

      expect(access.accessState).toBe("SUBSCRIPTION_UNKNOWN")
    })
  })

  describe("superadmins", () => {
    const superAdmin = (overrides: Partial<Session> = {}) =>
      session({
        user: {
          id: "u1",
          name: "Root",
          email: "root@example.com",
          isSuperAdmin: true,
        },
        ...overrides,
      })

    // Their active tenant is usually somebody else's organization, so the
    // paywall would send them to /billing/locked for a bill that is not theirs.
    it("is READY on an unpaid tenant they do not own", () => {
      const access = resolveUserAccess(
        superAdmin({
          isOwner: false,
          subscription: {
            status: "past_due",
            trialEndsAt: null,
            currentPeriodEnd: null,
          },
        })
      )

      expect(access.accessState).toBe("READY")
    })

    it("is READY when the subscription lookup failed", () => {
      expect(
        resolveUserAccess(superAdmin({ subscription: null })).accessState
      ).toBe("READY")
    })

    // The bypass is billing only. Without a tenant there is nothing to scope
    // the application to, so onboarding still applies.
    it("still goes through onboarding with no organization", () => {
      const access = resolveUserAccess(
        superAdmin({ activeTenantId: null, tenants: [] })
      )

      expect(access.accessState).toBe("NO_ORGANIZATION")
    })

    it("still has to choose between several organizations", () => {
      const access = resolveUserAccess(
        superAdmin({
          activeTenantId: null,
          tenants: [
            { id: "t1", name: "One" },
            { id: "t2", name: "Two" },
          ],
        })
      )

      expect(access.accessState).toBe("SELECT_ORGANIZATION")
    })
  })

  it("carries pending invitations through for the onboarding page", () => {
    const invitation = {
      id: "i1",
      tenantId: "t9",
      tenantName: "Acme",
      token: "tok",
      roleName: "operator",
      expiresAt: inDays(5),
    }

    const access = resolveUserAccess(
      session({
        activeTenantId: null,
        tenants: [],
        tenantInvites: [invitation],
      })
    )

    expect(access.accessState).toBe("NO_ORGANIZATION")
    expect(access.pendingInvitations).toEqual([invitation])
  })
})

describe("ACCESS_REDIRECTS", () => {
  // A state with no destination would silently fall through to `undefined` and
  // redirect to the site root, looping.
  it("names a destination for every non-ready state", () => {
    const states = [
      "AUTH_REQUIRED",
      "NO_ORGANIZATION",
      "SELECT_ORGANIZATION",
      "BILLING_REQUIRED",
      "BILLING_LOCKED",
      "SUBSCRIPTION_UNKNOWN",
    ] as const

    for (const state of states) {
      expect(ACCESS_REDIRECTS[state]).toMatch(/^\//)
    }
  })
})
