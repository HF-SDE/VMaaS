import {
  grantsAccess,
  hasValidSubscription,
  markSubscriptionActive,
  markSubscriptionCanceled,
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

describe("markSubscriptionActive", () => {
  it("clears a trial end date when the subscription becomes paid", async () => {
    upsert.mockResolvedValue(subscription({ status: "active" }));

    await markSubscriptionActive(TENANT);

    expect(upsert.mock.calls[0]![0].update).toMatchObject({ status: "active", trialEndsAt: null });
  });

  // Stripe delivers webhooks at least once, so the same activation may arrive
  // twice. Keyed on tenantId with a fixed status, the second write is the first.
  it("is idempotent: it upserts on the tenant rather than inserting", async () => {
    upsert.mockResolvedValue(subscription({ status: "active" }));

    await markSubscriptionActive(TENANT, { stripeSubscriptionId: "sub_dev_1" });
    await markSubscriptionActive(TENANT, { stripeSubscriptionId: "sub_dev_1" });

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [args] of upsert.mock.calls) expect(args.where).toEqual({ tenantId: TENANT });
  });

  // A later status-only event must not blank out ids an earlier event set.
  it("leaves the Stripe identifiers alone when none are supplied", async () => {
    upsert.mockResolvedValue(subscription({ status: "active" }));

    await markSubscriptionActive(TENANT);

    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty("stripeCustomerId");
    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty("stripeSubscriptionId");
  });
});

describe("markSubscriptionCanceled", () => {
  it("keeps the Stripe identifiers so the customer can be found again", async () => {
    upsert.mockResolvedValue(subscription({ status: "canceled" }));

    await markSubscriptionCanceled(TENANT);

    expect(upsert.mock.calls[0]![0].update).toEqual({ status: "canceled" });
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
