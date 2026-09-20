import { applyStripeSubscription, handleStripeWebhook } from "@/api/services/billing.service";

import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, findUnique, setSubscriptionStatus, constructEvent } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  setSubscriptionStatus: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { subscription: { findFirst }, tenant: { findUnique } },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent }, subscriptions: { retrieve: vi.fn() } },
  STRIPE_PRICE_IDS: { monthly: "price_monthly", yearly: "price_yearly" },
}));

vi.mock("@/api/services/subscriptions.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setSubscriptionStatus,
}));

const TENANT = "11111111-1111-4111-8111-111111111111";

/** The parts of a Stripe subscription this application reads. */
function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    cancel_at_period_end: false,
    trial_end: null,
    metadata: {},
    items: { data: [{ current_period_end: 1800000000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  findFirst.mockReset();
  findUnique.mockReset();
  setSubscriptionStatus.mockReset();
  constructEvent.mockReset();

  findFirst.mockResolvedValue({ tenantId: TENANT });
  setSubscriptionStatus.mockResolvedValue([null, {}]);
});

describe("applyStripeSubscription — status mapping", () => {
  it.each([
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["unpaid", "unpaid"],
    ["incomplete", "incomplete"],
    ["incomplete_expired", "incomplete"],
    ["canceled", "canceled"],
    ["paused", "canceled"],
  ] as const)("maps Stripe %s to %s", async (stripeStatus, expected) => {
    await applyStripeSubscription(stripeSubscription({ status: stripeStatus }));

    expect(setSubscriptionStatus).toHaveBeenCalledWith(TENANT, expected, expect.anything());
  });

  // A status Stripe adds after this was written must not read as "paid". The
  // default arm has to deny access, not fall through to the last case.
  it("denies access for a status it does not recognise", async () => {
    await applyStripeSubscription(stripeSubscription({ status: "something_new" }));

    expect(setSubscriptionStatus).toHaveBeenCalledWith(TENANT, "canceled", expect.anything());
  });
});

describe("applyStripeSubscription — the facts it carries across", () => {
  // Since Basil, current_period_end lives on the items, not the subscription.
  // Reading subscription.current_period_end would quietly write undefined.
  it("takes the period end from the subscription's items", async () => {
    await applyStripeSubscription(stripeSubscription());

    expect(setSubscriptionStatus).toHaveBeenCalledWith(
      TENANT,
      "active",
      expect.objectContaining({ currentPeriodEnd: new Date(1800000000 * 1000) }),
    );
  });

  it("carries a pending cancelation across while the status is still active", async () => {
    await applyStripeSubscription(stripeSubscription({ cancel_at_period_end: true }));

    expect(setSubscriptionStatus).toHaveBeenCalledWith(
      TENANT,
      "active",
      expect.objectContaining({ cancelAtPeriodEnd: true }),
    );
  });
});

describe("applyStripeSubscription — finding the tenant", () => {
  it("resolves through the stored Stripe identifiers", async () => {
    await applyStripeSubscription(stripeSubscription());

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ stripeSubscriptionId: "sub_123" }, { stripeCustomerId: "cus_123" }] },
      }),
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  // The first event of a new subscription arrives before any id is stored, so
  // the metadata written at checkout is the only link — but it is a claim, and
  // the tenant it names has to exist.
  it("falls back to checkout metadata when no row matches", async () => {
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({ id: TENANT });

    const [error] = await applyStripeSubscription(stripeSubscription({ metadata: { tenantId: TENANT } }));

    expect(error).toBeNull();
    expect(setSubscriptionStatus).toHaveBeenCalledWith(TENANT, "active", expect.anything());
  });

  it("refuses metadata naming a tenant that does not exist", async () => {
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue(null);

    const [error] = await applyStripeSubscription(stripeSubscription({ metadata: { tenantId: "not-a-tenant" } }));

    expect(error?.reason).toBe("UNKNOWN_TENANT");
    expect(setSubscriptionStatus).not.toHaveBeenCalled();
  });
});

describe("handleStripeWebhook", () => {
  // The signature is the whole of the authentication on this endpoint — it has
  // no session and cannot have one.
  it("rejects a payload with no signature without reading it", async () => {
    const [error] = await handleStripeWebhook(Buffer.from("{}"), undefined);

    expect(error?.reason).toBe("STRIPE_ERROR");
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a payload whose signature does not verify", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("no signatures found matching the expected signature");
    });

    const [error] = await handleStripeWebhook(Buffer.from("{}"), "t=1,v1=bogus");

    expect(error?.reason).toBe("STRIPE_ERROR");
    expect(setSubscriptionStatus).not.toHaveBeenCalled();
  });

  it("applies a verified subscription event", async () => {
    constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: { object: stripeSubscription({ status: "past_due" }) },
    });

    const [error, result] = await handleStripeWebhook(Buffer.from("{}"), "t=1,v1=good");

    expect(error).toBeNull();
    expect(result).toEqual({ received: true });
    expect(setSubscriptionStatus).toHaveBeenCalledWith(TENANT, "past_due", expect.anything());
  });

  // Checkout completing is not proof of payment: a delayed-notification method
  // completes the session while it is still unpaid. Granting access here would
  // let a payment that later fails in.
  it("ignores a completed checkout session that is still unpaid", async () => {
    constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", payment_status: "unpaid", subscription: "sub_123" } },
    });

    const [error] = await handleStripeWebhook(Buffer.from("{}"), "t=1,v1=good");

    expect(error).toBeNull();
    expect(setSubscriptionStatus).not.toHaveBeenCalled();
  });

  // Stripe retries anything that is not acknowledged. An event for a tenant
  // this application does not have would be retried forever, so it is logged
  // and accepted instead.
  it("acknowledges an event whose tenant cannot be resolved", async () => {
    findFirst.mockResolvedValue(null);
    constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: { object: stripeSubscription() },
    });

    const [error, result] = await handleStripeWebhook(Buffer.from("{}"), "t=1,v1=good");

    expect(error).toBeNull();
    expect(result).toEqual({ received: true });
  });

  // A write that failed, by contrast, is worth retrying — so it must not be
  // acknowledged.
  it("reports a failed write so Stripe redelivers", async () => {
    setSubscriptionStatus.mockResolvedValue([{ reason: "UNKNOWN_ERROR", message: "connection lost" }, null]);
    constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: { object: stripeSubscription() },
    });

    const [error] = await handleStripeWebhook(Buffer.from("{}"), "t=1,v1=good");

    expect(error?.reason).toBe("STRIPE_ERROR");
  });

  it("ignores an event type it does not act on", async () => {
    constructEvent.mockReturnValue({ type: "payment_intent.succeeded", data: { object: {} } });

    const [error] = await handleStripeWebhook(Buffer.from("{}"), "t=1,v1=good");

    expect(error).toBeNull();
    expect(setSubscriptionStatus).not.toHaveBeenCalled();
  });
});
