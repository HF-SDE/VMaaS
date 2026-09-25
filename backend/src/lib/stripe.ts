import { config } from "@/lib/config";

import Stripe from "stripe";

/**
 * The one Stripe client.
 *
 * An instance rather than the deprecated module-level `Stripe.apiKey` global,
 * and the API version is pinned: Stripe's account default can be moved in the
 * dashboard, and a version change that silently reshapes a webhook payload is
 * not something this codebase should be able to discover in production.
 */
export const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
  apiVersion: "2026-08-26.dahlia",
});

/** The two plans the application sells. The price ids live in the environment
 *  so a sandbox and production can price the same plan differently. */
export const STRIPE_PRICE_IDS = {
  monthly: config.STRIPE_PRICE_ID_MONTHLY,
  yearly: config.STRIPE_PRICE_ID_YEARLY,
} as const;
