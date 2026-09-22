/**
 * Subscription status, mirrored from the `subscription_status` enum in
 * `backend/prisma/schema.prisma`.
 *
 * It is written out here rather than imported from the generated Prisma client
 * because the frontend needs these as *values*, not just types. A type-only
 * import is erased at compile time and costs nothing, but comparing against
 * `subscription_status.trialing` keeps the import alive into the browser
 * bundle, which then tries to resolve `@prisma/client/runtime/index-browser`
 * from the frontend's own node_modules — where Prisma is not installed.
 *
 * Same shape as ALERT_TYPES in ./machineAlert. The schema stays the source of
 * truth; this is the copy both sides may hold.
 */
export const SUBSCRIPTION_STATUSES = [
  /** Tenant created, billing not yet started. Not an access-granting state. */
  "pending",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
