import { createCheckoutSession } from "@/api/services/billing.service";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, getTenantSubscription, claimTrial, releaseTrial } = vi.hoisted(() => ({
  create: vi.fn(),
  getTenantSubscription: vi.fn(),
  claimTrial: vi.fn(),
  releaseTrial: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create } } },
  STRIPE_PRICE_IDS: { monthly: "price_monthly", yearly: "price_yearly" },
}));

vi.mock("@/api/services/subscriptions.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTenantSubscription,
  claimTrial,
  releaseTrial,
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const INPUT = { tenantId: TENANT, userId: USER, plan: "monthly" as const, userEmail: "owner@example.com" };

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: "pending",
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

/** The arguments the last `checkout.sessions.create` was called with. */
function sentToStripe() {
  return create.mock.calls[0]![0];
}

beforeEach(() => {
  create.mockReset();
  getTenantSubscription.mockReset();
  claimTrial.mockReset();
  releaseTrial.mockReset();

  create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test" });
  getTenantSubscription.mockResolvedValue([null, subscription()]);
  claimTrial.mockResolvedValue([null, { trialDays: 30 }]);
  releaseTrial.mockResolvedValue([null, { released: true }]);
});

describe("createCheckoutSession — the trial", () => {
  it("asks Stripe for a trial as long as the claim allowed", async () => {
    claimTrial.mockResolvedValue([null, { trialDays: 30 }]);

    await createCheckoutSession(INPUT);

    expect(sentToStripe().subscription_data).toMatchObject({ trial_period_days: 30 });
  });

  // A user who has had their trial still gets to subscribe — they just pay from
  // day one. Sending `trial_period_days: 0` is not the same thing as sending
  // nothing, so the key has to be absent.
  it("omits the trial entirely when the claim was refused", async () => {
    claimTrial.mockResolvedValue([null, { trialDays: 0 }]);

    await createCheckoutSession(INPUT);

    expect(sentToStripe().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("claims the trial for the acting user and the active tenant", async () => {
    await createCheckoutSession(INPUT);

    expect(claimTrial).toHaveBeenCalledWith(USER, TENANT);
  });

  // The trial length is decided here, from the claim. If the caller could name
  // it, a user could ask for a trial they are not entitled to.
  it("ignores any trial length offered by the caller", async () => {
    claimTrial.mockResolvedValue([null, { trialDays: 0 }]);

    await createCheckoutSession({ ...INPUT, trialDays: 365 } as Parameters<typeof createCheckoutSession>[0]);

    expect(sentToStripe().subscription_data).not.toHaveProperty("trial_period_days");
  });

  // Without this the user reaches Stripe, the claim is never recorded, and the
  // next checkout hands them another trial.
  it("refuses checkout when the claim could not be recorded", async () => {
    claimTrial.mockResolvedValue([{ reason: "UNKNOWN_ERROR", message: "connection lost" }, null]);

    const [error] = await createCheckoutSession(INPUT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(create).not.toHaveBeenCalled();
  });

  // A tenant that is already paying is turned away before anything is claimed,
  // or a mistaken second checkout would spend a trial it never used.
  it("does not claim a trial for a tenant that already subscribes", async () => {
    getTenantSubscription.mockResolvedValue([
      null,
      subscription({ status: "active", stripeSubscriptionId: "sub_123" }),
    ]);

    const [error] = await createCheckoutSession(INPUT);

    expect(error?.reason).toBe("ALREADY_SUBSCRIBED");
    expect(claimTrial).not.toHaveBeenCalled();
  });

  // So `checkout.session.expired` knows whose claim to give back. Only when a
  // trial was actually claimed — otherwise expiry would release a claim made
  // by some other checkout.
  it("records whose trial it is on the session", async () => {
    await createCheckoutSession(INPUT);

    expect(sentToStripe().metadata).toMatchObject({ tenantId: TENANT, trialUserId: USER });
  });

  it("records no trial owner when no trial was claimed", async () => {
    claimTrial.mockResolvedValue([null, { trialDays: 0 }]);

    await createCheckoutSession(INPUT);

    expect(sentToStripe().metadata).not.toHaveProperty("trialUserId");
  });

  // No session exists, so `checkout.session.expired` will never arrive to give
  // the claim back. Without this a Stripe outage costs the user their trial
  // permanently.
  it("gives the trial back when Stripe refuses to open checkout", async () => {
    create.mockRejectedValue(new Error("stripe is down"));

    const [error] = await createCheckoutSession(INPUT);

    expect(error?.reason).toBe("STRIPE_ERROR");
    expect(releaseTrial).toHaveBeenCalledWith(USER, TENANT);
  });

  // Same reasoning: a session with no URL is one the user can never reach.
  it("gives the trial back when Stripe returns a session with no url", async () => {
    create.mockResolvedValue({ url: null });

    const [error] = await createCheckoutSession(INPUT);

    expect(error?.reason).toBe("STRIPE_ERROR");
    expect(releaseTrial).toHaveBeenCalledWith(USER, TENANT);
  });

  // There is nothing to give back, and releasing on both ids would delete a
  // claim this checkout never made.
  it("releases nothing on failure when no trial was claimed", async () => {
    claimTrial.mockResolvedValue([null, { trialDays: 0 }]);
    create.mockRejectedValue(new Error("stripe is down"));

    await createCheckoutSession(INPUT);

    expect(releaseTrial).not.toHaveBeenCalled();
  });
});

describe("createCheckoutSession — where checkout returns to", () => {
  // `FRONTEND_URL` holds every allowed browser origin, so it is a list. A link
  // needs one of them: interpolating the list joins it with commas and hands
  // Stripe a URL no browser can follow.
  it("returns to a single origin, not the whole allow-list", async () => {
    await createCheckoutSession(INPUT);

    expect(sentToStripe().success_url).toBe("http://localhost:3000/billing?checkout=success");
    expect(sentToStripe().cancel_url).toBe("http://localhost:3000/billing?checkout=canceled");
  });
});

describe("createCheckoutSession — the card", () => {
  // The trial is only free if they cancel; the card has to be on file before it
  // starts. `if_required` would let a trial begin with no payment method at
  // all, so this is stated rather than left to Stripe's default.
  it("always collects a payment method", async () => {
    await createCheckoutSession(INPUT);

    expect(sentToStripe().payment_method_collection).toBe("always");
  });

  // If the card is gone by the time the trial ends, the subscription ends too.
  // The alternative — an unpaid invoice — is a debt for a service nobody paid
  // for and access this application would have to claw back.
  it("cancels rather than invoicing when the card is gone at trial end", async () => {
    await createCheckoutSession(INPUT);

    expect(sentToStripe().subscription_data.trial_settings).toEqual({
      end_behavior: { missing_payment_method: "cancel" },
    });
  });
});
