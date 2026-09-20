/**
 * One paid invoice for a tenant's own subscription — a receipt.
 *
 * Mirrored from Stripe on each request rather than stored: the `subscriptions`
 * table keeps only `stripeCustomerId`, and Stripe stays the record of what was
 * actually billed. Nothing here is a number the application computed.
 */
export interface TenantInvoice {
  id: string;
  /** The number Stripe prints on the PDF. Null only on an invoice Stripe has
   *  not finalized, which `listInvoices` filters out. */
  number: string | null;
  /** Seconds since the epoch, as Stripe reports it — not milliseconds. */
  created: number;
  /** Minor units: 29900 is 299,00 kr. Never divided server-side, so the browser
   *  formats it against `currency` and no rounding happens twice. */
  amountPaid: number;
  currency: string;
  /** The Stripe-hosted PDF, for downloading. */
  pdfUrl: string | null;
  /** The Stripe-hosted invoice page, for viewing in a tab. */
  hostedUrl: string | null;
}

/**
 * One page of receipts.
 *
 * Deliberately not `GetPaginatedResult`: Stripe pages by cursor and reports no
 * total, so `totalCount` and `pageCount` could only be invented. `nextCursor`
 * is the last invoice id on this page, which is what Stripe's `starting_after`
 * takes — an opaque token to hand back, never an offset to do arithmetic on.
 */
export interface TenantInvoicePage {
  data: TenantInvoice[];
  hasMore: boolean;
  nextCursor: string | null;
}
