import { listInvoices } from "@/api/services/billing.service";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { list, getTenantSubscription } = vi.hoisted(() => ({
  list: vi.fn(),
  getTenantSubscription: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/stripe", () => ({
  stripe: { invoices: { list } },
  STRIPE_PRICE_IDS: { monthly: "price_monthly", yearly: "price_yearly" },
}));

vi.mock("@/api/services/subscriptions.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTenantSubscription,
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "cus_test123";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    stripeCustomerId: CUSTOMER,
    stripeSubscriptionId: "sub_test123",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_1",
    number: "VMAAS-0001",
    created: 1757000000,
    amount_paid: 29900,
    currency: "dkk",
    invoice_pdf: "https://pay.stripe.com/invoice/in_1/pdf",
    hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return { object: "list", data: [invoice()], has_more: false, url: "/v1/invoices", ...overrides };
}

/** The arguments the last `invoices.list` was called with. */
function sentToStripe() {
  return list.mock.calls[0]![0];
}

beforeEach(() => {
  list.mockReset();
  getTenantSubscription.mockReset();

  list.mockResolvedValue(page());
  getTenantSubscription.mockResolvedValue([null, subscription()]);
});

describe("listInvoices — which invoices are asked for", () => {
  it("asks only for the invoices of this tenant's own Stripe customer", async () => {
    await listInvoices(TENANT);

    expect(sentToStripe()).toMatchObject({ customer: CUSTOMER });
  });

  // A receipt is a paid invoice. The filter is also what makes "every row is a
  // link" true: Stripe leaves `invoice_pdf` null until an invoice is finalized,
  // so an unfiltered list could return a draft row with nothing to download.
  it("asks only for paid invoices", async () => {
    await listInvoices(TENANT);

    expect(sentToStripe()).toMatchObject({ status: "paid" });
  });

  // Null until the first webhook lands after checkout. A tenant that never got
  // that far has no receipts rather than a broken page, and asking Stripe about
  // a customer that does not exist would be an error where an empty list is the
  // truthful answer.
  it("returns an empty page without calling Stripe when the tenant has no customer", async () => {
    getTenantSubscription.mockResolvedValue([null, subscription({ stripeCustomerId: null })]);

    const [error, result] = await listInvoices(TENANT);

    expect(error).toBeNull();
    expect(result).toEqual({ data: [], hasMore: false, nextCursor: null });
    expect(list).not.toHaveBeenCalled();
  });

  it("reports a failure to read the subscription rather than guessing at a customer", async () => {
    getTenantSubscription.mockResolvedValue([{ reason: "UNKNOWN_ERROR", message: "connection lost" }, null]);

    const [error] = await listInvoices(TENANT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("listInvoices — the page size", () => {
  it("defaults the page size when the caller names none", async () => {
    await listInvoices(TENANT);

    expect(sentToStripe()).toMatchObject({ limit: 10 });
  });

  // Clamped rather than rejected, so a stale bookmark still renders a page
  // instead of a 400. Stripe itself refuses a limit above 100.
  it("clamps a page size above Stripe's maximum", async () => {
    await listInvoices(TENANT, { limit: 5000 });

    expect(sentToStripe()).toMatchObject({ limit: 100 });
  });

  it("clamps a page size below one", async () => {
    await listInvoices(TENANT, { limit: 0 });

    expect(sentToStripe()).toMatchObject({ limit: 1 });
  });

  it("truncates a fractional page size", async () => {
    await listInvoices(TENANT, { limit: 7.9 });

    expect(sentToStripe()).toMatchObject({ limit: 7 });
  });
});

describe("listInvoices — the cursor", () => {
  it("passes the caller's cursor to Stripe", async () => {
    await listInvoices(TENANT, { startingAfter: "in_previous" });

    expect(sentToStripe()).toMatchObject({ starting_after: "in_previous" });
  });

  // Stripe reads an empty `starting_after` as a cursor rather than as its
  // absence, so the first page has to omit the key entirely.
  it("omits the cursor entirely on the first page", async () => {
    await listInvoices(TENANT);

    expect(sentToStripe()).not.toHaveProperty("starting_after");
  });

  it("hands back the last invoice on the page as the next cursor", async () => {
    list.mockResolvedValue(page({ data: [invoice({ id: "in_1" }), invoice({ id: "in_2" })], has_more: true }));

    const [, result] = await listInvoices(TENANT);

    expect(result).toMatchObject({ hasMore: true, nextCursor: "in_2" });
  });

  // Without this the UI would offer a "next" that returns nothing.
  it("hands back no cursor when Stripe says there is no next page", async () => {
    list.mockResolvedValue(page({ has_more: false }));

    const [, result] = await listInvoices(TENANT);

    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
  });
});

describe("listInvoices — the receipt", () => {
  it("maps Stripe's invoice onto the receipt the API returns", async () => {
    const [, result] = await listInvoices(TENANT);

    expect(result!.data[0]).toEqual({
      id: "in_1",
      number: "VMAAS-0001",
      created: 1757000000,
      amountPaid: 29900,
      currency: "dkk",
      pdfUrl: "https://pay.stripe.com/invoice/in_1/pdf",
      hostedUrl: "https://invoice.stripe.com/i/in_1",
    });
  });

  // Stripe omits both keys rather than sending null on an invoice it has not
  // finalized. `undefined` would disappear from the JSON response and leave the
  // browser reading a missing property instead of an absent link.
  it("reports a missing pdf as null rather than dropping the key", async () => {
    list.mockResolvedValue(page({ data: [invoice({ invoice_pdf: undefined, hosted_invoice_url: undefined })] }));

    const [, result] = await listInvoices(TENANT);

    expect(result!.data[0]).toMatchObject({ pdfUrl: null, hostedUrl: null });
  });

  it("reports a Stripe failure rather than throwing", async () => {
    list.mockRejectedValue(new Error("stripe is down"));

    const [error] = await listInvoices(TENANT);

    expect(error?.reason).toBe("STRIPE_ERROR");
  });
});
