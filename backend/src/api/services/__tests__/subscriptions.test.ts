import {
  TRIAL_PERIOD_DAYS,
  claimTrial,
  grantsAccess,
  hasValidSubscription,
  releaseTrial,
  setSubscriptionStatus,
} from "@/api/services/subscriptions.service";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, findUnique, grantCreate, grantDeleteMany } = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  grantCreate: vi.fn(),
  grantDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { upsert, findUnique },
    trialGrant: { create: grantCreate, deleteMany: grantDeleteMany },
  },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

/** What Prisma throws when a `create` collides with a unique constraint. */
function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

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
  grantCreate.mockReset();
  grantDeleteMany.mockReset();
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

describe("claimTrial", () => {
  it("grants the trial the first time a user asks for one", async () => {
    grantCreate.mockResolvedValue({ userId: USER, tenantId: TENANT });

    const [error, result] = await claimTrial(USER, TENANT);

    expect(error).toBeNull();
    expect(result?.trialDays).toBe(TRIAL_PERIOD_DAYS);
  });

  // The whole point of the table: a user who has had a trial does not get a
  // second one, however many organizations they create.
  it("refuses a user who has already had a trial", async () => {
    grantCreate.mockRejectedValue(uniqueViolation());

    const [error, result] = await claimTrial(USER, TENANT);

    expect(error).toBeNull();
    expect(result?.trialDays).toBe(0);
  });

  // `tenantId` is unique too, so handing an organization to a new owner cannot
  // buy it a second trial.
  it("refuses an organization that has already had a trial", async () => {
    grantCreate.mockRejectedValue(uniqueViolation());

    const [, result] = await claimTrial("33333333-3333-4333-8333-333333333333", TENANT);

    expect(result?.trialDays).toBe(0);
  });

  // The row is written before the user reaches Stripe, so two checkouts opened
  // at once cannot both read "no grant yet" and both start a trial. The unique
  // constraint is the lock, which means the claim must happen on `create` —
  // not on a find-then-create.
  it("claims by inserting, so concurrent checkouts race on the constraint", async () => {
    grantCreate.mockResolvedValue({ userId: USER, tenantId: TENANT });

    await claimTrial(USER, TENANT);

    expect(grantCreate).toHaveBeenCalledWith({ data: { userId: USER, tenantId: TENANT } });
  });

  // A database that is down must not be read as "eligible" — that would hand
  // out a trial per failed request.
  it("reports a write failure rather than granting a trial", async () => {
    grantCreate.mockRejectedValue(new Error("connection lost"));

    const [error] = await claimTrial(USER, TENANT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});

describe("releaseTrial", () => {
  // Claiming at checkout means an abandoned checkout would otherwise burn the
  // user's only trial. Stripe expires the session after 24h and this gives it
  // back.
  it("gives the claim back so the user can try again", async () => {
    grantDeleteMany.mockResolvedValue({ count: 1 });

    const [error] = await releaseTrial(USER, TENANT);

    expect(error).toBeNull();
    expect(grantDeleteMany).toHaveBeenCalledWith({ where: { userId: USER, tenantId: TENANT } });
  });

  // The subscription outlives the checkout session, so a released claim for a
  // trial that did convert would be a second free trial. Only an unconverted
  // claim is released, which `deleteMany` on both ids expresses: nothing
  // matches once the row belongs to a different checkout.
  it("succeeds when there is no claim left to release", async () => {
    grantDeleteMany.mockResolvedValue({ count: 0 });

    const [error] = await releaseTrial(USER, TENANT);

    expect(error).toBeNull();
  });

  it("reports a failure to release", async () => {
    grantDeleteMany.mockRejectedValue(new Error("connection lost"));

    const [error] = await releaseTrial(USER, TENANT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});
