import {
  grantsAccess,
  hasValidSubscription,
  setSubscriptionStatus,
  startSubscriptionTrial,
} from "@/api/services/subscriptions.service";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, findUnique } = vi.hoisted(() => ({ upsert: vi.fn(), findUnique: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { subscription: { upsert, findUnique } } }));

const TENANT = "11111111-1111-4111-8111-111111111111";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
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

beforeEach(() => {
  upsert.mockReset();
  findUnique.mockReset();
});

describe("grantsAccess", () => {
  it.each(["active", "trialing"] as const)("lets %s into the application", (status) => {
    expect(grantsAccess(status)).toBe(true);
  });

  // The paywall is the default: anything that is not positively a paid or
  // trialing state must keep the user out.
  it.each(["pending", "past_due", "canceled", "incomplete", "unpaid"] as const)("keeps %s out", (status) => {
    expect(grantsAccess(status)).toBe(false);
  });
});

describe("hasValidSubscription", () => {
  it("grants access to an active subscription", async () => {
    upsert.mockResolvedValue(subscription({ status: "active" }));

    const [error, isValid] = await hasValidSubscription(TENANT);

    expect(error).toBeNull();
    expect(isValid).toBe(true);
  });

  it("grants access to a trial that has not run out", async () => {
    upsert.mockResolvedValue(subscription({ status: "trialing", trialEndsAt: new Date(Date.now() + 86_400_000) }));

    const [, isValid] = await hasValidSubscription(TENANT);

    expect(isValid).toBe(true);
  });

  // Nothing sweeps expired trials today — no Stripe, no cron — so an elapsed
  // trialEndsAt has to be caught at read time or a lapsed trial keeps working.
  it("refuses a trial whose end date has passed", async () => {
    upsert.mockResolvedValue(subscription({ status: "trialing", trialEndsAt: new Date(Date.now() - 1000) }));

    const [, isValid] = await hasValidSubscription(TENANT);

    expect(isValid).toBe(false);
  });

  it("refuses a pending subscription", async () => {
    upsert.mockResolvedValue(subscription({ status: "pending" }));

    const [, isValid] = await hasValidSubscription(TENANT);

    expect(isValid).toBe(false);
  });

  it("reports a lookup failure instead of guessing", async () => {
    upsert.mockRejectedValue(new Error("connection lost"));

    const [error] = await hasValidSubscription(TENANT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});

describe("setSubscriptionStatus", () => {
  it("writes the status and the Stripe facts that came with it", async () => {
    const periodEnd = new Date("2027-01-01T00:00:00Z");
    upsert.mockResolvedValue(subscription({ status: "active" }));

    await setSubscriptionStatus(TENANT, "active", {
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    expect(upsert.mock.calls[0]![0].update).toMatchObject({
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });
  });

  // Stripe delivers webhooks at least once, so the same event may arrive twice.
  // Keyed on tenantId with a status the caller decided, the second write is the
  // first.
  it("is idempotent: it upserts on the tenant rather than inserting", async () => {
    upsert.mockResolvedValue(subscription({ status: "active" }));

    await setSubscriptionStatus(TENANT, "active", { stripeSubscriptionId: "sub_123" });
    await setSubscriptionStatus(TENANT, "active", { stripeSubscriptionId: "sub_123" });

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [args] of upsert.mock.calls) expect(args.where).toEqual({ tenantId: TENANT });
  });

  // A later status-only event must not blank out ids or a period end that an
  // earlier event set.
  it("leaves fields the caller did not supply alone", async () => {
    upsert.mockResolvedValue(subscription({ status: "past_due" }));

    await setSubscriptionStatus(TENANT, "past_due");

    expect(upsert.mock.calls[0]![0].update).toEqual({ status: "past_due" });
  });

  // Cancelation is not a status: Stripe keeps the subscription active until the
  // paid period runs out, so this flag is the only thing that says it is ending.
  it("records a cancelation that has not taken effect yet", async () => {
    upsert.mockResolvedValue(subscription({ status: "active", cancelAtPeriodEnd: true }));

    await setSubscriptionStatus(TENANT, "active", { cancelAtPeriodEnd: true });

    expect(upsert.mock.calls[0]![0].update).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });
});

describe("startSubscriptionTrial", () => {
  it("starts a trial on a pending subscription", async () => {
    findUnique.mockResolvedValue(subscription({ status: "pending" }));
    upsert.mockResolvedValue(subscription({ status: "trialing" }));

    const [, result] = await startSubscriptionTrial(TENANT);

    expect(result?.status).toBe("trialing");
  });

  // Re-running onboarding must never extend a real subscription or revive a
  // canceled one into a free trial.
  it.each(["active", "canceled", "past_due"] as const)("leaves a %s subscription untouched", async (status) => {
    findUnique.mockResolvedValue(subscription({ status }));

    const [, result] = await startSubscriptionTrial(TENANT);

    expect(upsert).not.toHaveBeenCalled();
    expect(result?.status).toBe(status);
  });
});
