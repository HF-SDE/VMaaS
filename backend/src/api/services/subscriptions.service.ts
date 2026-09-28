import { type Subscription, type subscription_plan, type subscription_status } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import * as Sentry from "@sentry/node";
import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";

/**
 * The one place subscription state changes.
 *
 * Nothing outside this file may write `subscriptions` rows. The Stripe webhook
 * handler in `billing.service.ts` is the only caller that grants access, and it
 * does so through `setSubscriptionStatus` here, so there is a single definition
 * of what "active" means and no second "the payment went through" branch
 * anywhere in the app.
 *
 * Stripe itself stays out of this file: it knows about `subscription_status`
 * and nothing about checkout sessions, events or price ids. The mapping from
 * Stripe's vocabulary onto these functions lives in `billing.service.ts`.
 */

export type UnknownSubscriptionError = { reason: "UNKNOWN_ERROR"; message: string };

/** The states that let a user into the application. Everything else — pending,
 *  past_due, canceled, incomplete, unpaid — is a paywall. */
export const ACCESS_GRANTING_STATUSES = ["active", "trialing"] as const satisfies readonly subscription_status[];

export function grantsAccess(status: subscription_status): boolean {
  return (ACCESS_GRANTING_STATUSES as readonly subscription_status[]).includes(status);
}

/** How long a free trial lasts. A constant rather than configuration: changing
 *  it changes what was sold, so it belongs in a commit, not an environment. */
export const TRIAL_PERIOD_DAYS = 30;

function unknownError(action: string, cause: unknown): Result<UnknownSubscriptionError, never> {
  Sentry.captureException(cause, { tags: { service: "subscriptions", action } });
  console.error(`[subscriptions.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the subscription.`,
  });
}

/**
 * The tenant's subscription, creating a `pending` row the first time one is
 * asked for.
 *
 * Upsert rather than find, so a tenant created before billing existed — or by
 * a code path that forgot to create one — still resolves to a definite state
 * instead of `null` that every caller would have to re-interpret. `pending`
 * grants no access, so materialising the row cannot let anyone in.
 */
export async function getTenantSubscription(tenantId: string): Promise<Result<UnknownSubscriptionError, Subscription>> {
  try {
    return ok(
      await prisma.subscription.upsert({
        where: { tenantId },
        update: {},
        create: { tenantId, status: "pending" },
      }),
    );
  } catch (error) {
    return unknownError("loading", error);
  }
}

/**
 * Whether `tenantId` may use the application right now.
 *
 * A trial that has run out is not access. Every trial is a Stripe one, so
 * Stripe does move the subscription on when it ends — but that is an event in
 * flight, and until it lands the row still reads `trialing`. An elapsed
 * `trialEndsAt` is therefore treated as expired here rather than trusted.
 *
 * That means a converting customer is refused for as long as the webhook takes
 * to arrive, which is the right way round: the alternative is free use of the
 * application by anyone whose trial ended and whose card then failed.
 */
export async function hasValidSubscription(tenantId: string): Promise<Result<UnknownSubscriptionError, boolean>> {
  const [error, subscription] = await getTenantSubscription(tenantId);
  if (error) return err(error);

  if (!grantsAccess(subscription.status)) return ok(false);

  if (subscription.status === "trialing" && subscription.trialEndsAt && subscription.trialEndsAt < new Date()) {
    return ok(false);
  }

  return ok(true);
}

export type SubscriptionFacts = {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Date;
  /** Stripe keeps a canceled-at-period-end subscription `active` until the
   *  period runs out, so this cannot be inferred from the status. */
  cancelAtPeriodEnd?: boolean;
  trialEndsAt?: Date | null;
  /** `null` is "Stripe is billing a price this application does not sell", and
   *  is deliberately different from omitting the field: the plan on the row has
   *  to be cleared rather than left claiming a plan the tenant is no longer on. */
  plan?: subscription_plan | null;
};

/**
 * Claims this user's one free trial for this tenant.
 *
 * Returns the trial length to ask Stripe for: `TRIAL_PERIOD_DAYS` if the claim
 * was theirs to make, `0` if it was not. A used-up trial is an answer, not an
 * error — the user still gets to subscribe, they just pay from day one.
 *
 * The claim is the insert itself. Reading first and then inserting would let
 * two checkouts opened at the same moment both see "no trial yet", so the
 * unique constraints on `userId` and `tenantId` are what actually enforce
 * this; a `P2002` means somebody already holds the claim.
 *
 * Called when checkout opens rather than when Stripe confirms the trial,
 * because a claim made after the fact cannot prevent the race it exists for.
 * `releaseTrial` is what keeps that from punishing an abandoned checkout.
 */
export async function claimTrial(
  userId: string,
  tenantId: string,
): Promise<Result<UnknownSubscriptionError, { trialDays: number }>> {
  try {
    await prisma.trialGrant.create({ data: { userId, tenantId } });

    return ok({ trialDays: TRIAL_PERIOD_DAYS });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return ok({ trialDays: 0 });

    // Not "no trial": a database that is down would hand out one trial per
    // failed request if this fell through to `trialDays: 0`, and would tell
    // the user they had used a trial they never got if it did the opposite.
    return unknownError("claiming the trial on", error);
  }
}

/**
 * Gives an unconverted claim back.
 *
 * Both ids are in the `where` on purpose. The claim row is rewritten to no
 * other pair, so once a different checkout holds the trial nothing matches and
 * the delete is a no-op — a stale `checkout.session.expired` cannot take away
 * a trial that has since started.
 */
export async function releaseTrial(
  userId: string,
  tenantId: string,
): Promise<Result<UnknownSubscriptionError, { released: boolean }>> {
  try {
    const { count } = await prisma.trialGrant.deleteMany({ where: { userId, tenantId } });

    return ok({ released: count > 0 });
  } catch (error) {
    return unknownError("releasing the trial on", error);
  }
}

/**
 * Applies a status to a tenant, with whatever Stripe facts came with it.
 *
 * The single write behind the Stripe webhook, and the only function that
 * grants access. Idempotent by construction — an upsert keyed on `tenantId`
 * writing a status the caller decided — so an event Stripe delivers twice
 * produces the same row, which is the at-least-once guarantee Stripe actually
 * offers.
 *
 * Every field is applied only when the caller supplied it: a status-only event
 * must not blank out identifiers or a period end that an earlier event set.
 */
export async function setSubscriptionStatus(
  tenantId: string,
  status: subscription_status,
  input: SubscriptionFacts = {},
): Promise<Result<UnknownSubscriptionError, Subscription>> {
  const fields = {
    ...(input.stripeCustomerId !== undefined ? { stripeCustomerId: input.stripeCustomerId } : {}),
    ...(input.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
    ...(input.currentPeriodEnd !== undefined ? { currentPeriodEnd: input.currentPeriodEnd } : {}),
    ...(input.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd } : {}),
    ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt } : {}),
    ...(input.plan !== undefined ? { plan: input.plan } : {}),
  };

  try {
    return ok(
      await prisma.subscription.upsert({
        where: { tenantId },
        update: { status, ...fields },
        create: { tenantId, status, ...fields },
      }),
    );
  } catch (error) {
    return unknownError("updating", error);
  }
}
