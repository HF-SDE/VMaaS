import { z } from "zod/v4";

/**
 * The shape of the DEVELOPMENT-ONLY simulated billing event.
 *
 * Deliberately *not* Stripe's payload: recreating that format would be work
 * thrown away the moment the real webhook lands. All this has to do is name an
 * intent. `organizationId` is accepted so the body reads like a webhook, but
 * the server only ever compares it against the session's tenant — it is never
 * used to choose one.
 */
export const simulateSubscriptionEventSchema = z.object({
  type: z.enum(["subscription.activated", "subscription.canceled"]).default("subscription.activated"),
  organizationId: z.uuid().optional(),
  subscriptionId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  status: z.string().optional(),
});

export type SimulateSubscriptionEvent = z.infer<typeof simulateSubscriptionEventSchema>;
