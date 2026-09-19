import { type Subscription, type subscription_status } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";

/**
 * The one place subscription state changes.
 *
 * Nothing outside this file may write `subscriptions` rows. The development
 * simulation in `subscriptions.controller.ts` and the Stripe webhook that will
 * eventually replace it both call `markSubscriptionActive` /
 * `markSubscriptionCanceled` here, so there is a single definition of what
 * "active" means and no "fake payment" branch anywhere else in the app.
 *
 * Stripe itself is deliberately absent — no SDK, no checkout, no webhook
 * secret. Adding it later means adding a caller to these functions, not
 * changing them.
 */

export type SubscriptionNotFoundError = { reason: "SUBSCRIPTION_NOT_FOUND"; message: string };
export type UnknownSubscriptionError = { reason: "UNKNOWN_ERROR"; message: string };

/** The states that let a user into the application. Everything else — pending,
 *  past_due, canceled, incomplete, unpaid — is a paywall. */
export const ACCESS_GRANTING_STATUSES = ["active", "trialing"] as const satisfies readonly subscription_status[];

export function grantsAccess(status: subscription_status): boolean {
  return (ACCESS_GRANTING_STATUSES as readonly subscription_status[]).includes(status);
}

/** How long a simulated or future Stripe period runs for. */
const PERIOD_DAYS = 30;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function unknownError(action: string, cause: unknown): Result<UnknownSubscriptionError, never> {
  // TODO: capture sentry error
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
export async function getTenantSubscription(
  tenantId: string,
): Promise<Result<UnknownSubscriptionError, Subscription>> {
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
 * A trial that has run out is not access: Stripe would move such a row to
 * `past_due` via webhook, but until Stripe exists nothing does, so an elapsed
 * `trialEndsAt` is treated as expired here rather than trusted blindly.
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

export type MarkActiveInput = {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Date;
};

/**
 * Moves a tenant's subscription to `active`.
 *
 * This is what a `customer.subscription.created` / `.updated` webhook will
 * call, and what the development simulation calls today. It is idempotent by
 * construction — an upsert keyed on `tenantId` writing a fixed status — so a
 * Stripe webhook delivered twice produces the same row, which is the delivery
 * guarantee Stripe actually offers.
 */
export async function markSubscriptionActive(
  tenantId: string,
  input: MarkActiveInput = {},
): Promise<Result<UnknownSubscriptionError, Subscription>> {
  const currentPeriodEnd = input.currentPeriodEnd ?? daysFromNow(PERIOD_DAYS);

  // Only overwrite the Stripe identifiers when the caller supplied them: a
  // later status-only update must not blank out ids an earlier event set.
  const stripeFields = {
    ...(input.stripeCustomerId !== undefined ? { stripeCustomerId: input.stripeCustomerId } : {}),
    ...(input.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
  };

  try {
    return ok(
      await prisma.subscription.upsert({
        where: { tenantId },
        update: { status: "active", currentPeriodEnd, trialEndsAt: null, ...stripeFields },
        create: { tenantId, status: "active", currentPeriodEnd, ...stripeFields },
      }),
    );
  } catch (error) {
    return unknownError("activating", error);
  }
}

/**
 * Moves a tenant's subscription to `canceled`. The Stripe identifiers are kept:
 * they are how a later reactivation finds the same customer.
 */
export async function markSubscriptionCanceled(
  tenantId: string,
): Promise<Result<UnknownSubscriptionError, Subscription>> {
  try {
    return ok(
      await prisma.subscription.upsert({
        where: { tenantId },
        update: { status: "canceled" },
        create: { tenantId, status: "canceled" },
      }),
    );
  } catch (error) {
    return unknownError("canceling", error);
  }
}

/**
 * Starts a trial for a tenant that has no billing yet.
 *
 * Only moves a `pending` row: re-running it must never extend a real Stripe
 * subscription or revive a canceled one.
 */
export async function startSubscriptionTrial(
  tenantId: string,
  trialDays = 14,
): Promise<Result<UnknownSubscriptionError, Subscription>> {
  try {
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });

    if (existing && existing.status !== "pending") return ok(existing);

    const trialEndsAt = daysFromNow(trialDays);

    return ok(
      await prisma.subscription.upsert({
        where: { tenantId },
        update: { status: "trialing", trialEndsAt },
        create: { tenantId, status: "trialing", trialEndsAt },
      }),
    );
  } catch (error) {
    return unknownError("starting the trial on", error);
  }
}

/**
 * Applies an arbitrary Stripe status to a tenant.
 *
 * The mapping from Stripe's own status strings onto `subscription_status` is
 * the last thing the Stripe integration will need, and it lands here rather
 * than in the webhook handler so the handler stays a signature check plus a
 * lookup.
 */
export async function setSubscriptionStatus(
  tenantId: string,
  status: subscription_status,
  input: MarkActiveInput = {},
): Promise<Result<UnknownSubscriptionError, Subscription>> {
  const stripeFields = {
    ...(input.stripeCustomerId !== undefined ? { stripeCustomerId: input.stripeCustomerId } : {}),
    ...(input.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
    ...(input.currentPeriodEnd !== undefined ? { currentPeriodEnd: input.currentPeriodEnd } : {}),
  };

  try {
    return ok(
      await prisma.subscription.upsert({
        where: { tenantId },
        update: { status, ...stripeFields },
        create: { tenantId, status, ...stripeFields },
      }),
    );
  } catch (error) {
    return unknownError("updating", error);
  }
}
