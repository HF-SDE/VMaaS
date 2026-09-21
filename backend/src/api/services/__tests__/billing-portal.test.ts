import { createBillingPortalSession } from "@/api/services/billing.service";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, getTenantSubscription } = vi.hoisted(() => ({
  create: vi.fn(),
  getTenantSubscription: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/stripe", () => ({
  stripe: { billingPortal: { sessions: { create } } },
  STRIPE_PRICE_IDS: { monthly: "price_monthly", yearly: "price_yearly" },
}));

vi.mock("@/api/services/subscriptions.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTenantSubscription,
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "cus_test123";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    stripeCustomerId: CUSTOMER,
    stripeSubscriptionId: "sub_test123",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

/** The arguments the last `billingPortal.sessions.create` was called with. */
function sentToStripe() {
  return create.mock.calls[0]![0];
}

beforeEach(() => {
  create.mockReset();
  getTenantSubscription.mockReset();

  create.mockResolvedValue({ url: "https://billing.stripe.com/p/session_test" });
  getTenantSubscription.mockResolvedValue([null, subscription()]);
});

describe("createBillingPortalSession — whose billing is opened", () => {
  // The customer id comes from the tenant's own row, so there is no id in the
  // request that could open somebody else's billing.
  it("opens the portal for this tenant's own Stripe customer", async () => {
    await createBillingPortalSession(TENANT);

    expect(sentToStripe()).toMatchObject({ customer: CUSTOMER });
  });

  // Null until the first webhook lands after checkout. There is nothing to
  // manage yet, and asking Stripe about a customer it has never heard of would
  // turn the truthful answer into a 502.
  it("refuses without calling Stripe when the tenant has no customer", async () => {
    getTenantSubscription.mockResolvedValue([null, subscription({ stripeCustomerId: null })]);

    const [error] = await createBillingPortalSession(TENANT);

    expect(error?.reason).toBe("NO_STRIPE_CUSTOMER");
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a failure to read the subscription rather than guessing at a customer", async () => {
    getTenantSubscription.mockResolvedValue([{ reason: "UNKNOWN_ERROR", message: "connection lost" }, null]);

    const [error] = await createBillingPortalSession(TENANT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("createBillingPortalSession — the session", () => {
  it("hands back the URL to send the browser to", async () => {
    const [error, session] = await createBillingPortalSession(TENANT);

    expect(error).toBeNull();
    expect(session).toEqual({ url: "https://billing.stripe.com/p/session_test" });
  });

  it("sends the customer back to the account page when they are done", async () => {
    await createBillingPortalSession(TENANT);

    expect(sentToStripe().return_url).toContain("/account");
  });

  it("reports a Stripe failure rather than throwing", async () => {
    create.mockRejectedValue(new Error("stripe is down"));

    const [error] = await createBillingPortalSession(TENANT);

    expect(error?.reason).toBe("STRIPE_ERROR");
  });
});
