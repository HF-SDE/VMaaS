import { z } from "zod/v4";

/**
 * The two plans the application sells. The names are the contract between the
 * browser and the API — the price ids they map to are server-side
 * configuration (`STRIPE_PRICE_ID_MONTHLY` / `_YEARLY`) and are never accepted
 * from a client, so nobody can check out against a price of their choosing.
 */
export const subscriptionPlanSchema = z.enum(["monthly", "yearly"]);

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

/** `POST /api/subscriptions/checkout`. The tenant comes from the session, never
 *  the body — see the controller. */
export const createCheckoutSessionSchema = z.object({
  body: z.object({
    plan: subscriptionPlanSchema,
  }),
});

export type CreateCheckoutSessionBody = z.infer<typeof createCheckoutSessionSchema>["body"];
