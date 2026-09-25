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

/**
 * `GET /api/subscriptions/invoices`. Request-shaped so it runs through
 * `validate()` like every other schema, and every field stays optional — a bare
 * `/invoices` is a valid request for the first page. The service clamps what it
 * gets rather than rejecting it.
 *
 * `startingAfter` is an opaque Stripe invoice id taken from the previous page's
 * `nextCursor`, not an offset: Stripe pages by cursor, so there is no page
 * number to jump to and nothing here to do arithmetic on.
 */
export const getInvoicesPageSchema = z.object({
  query: z.object({
    limit: z.coerce.number().optional(),
    startingAfter: z.string().optional(),
  }),
});

export type GetInvoicesPageQuery = z.infer<typeof getInvoicesPageSchema>["query"];
