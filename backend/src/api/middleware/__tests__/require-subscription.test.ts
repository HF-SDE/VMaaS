import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireSubscription } from "@/api/middleware/require-subscription";

// The middleware's only dependency: mocking it keeps this a test of the
// decision, not of Prisma.
const hasValidSubscription = vi.fn();
vi.mock("@/api/services/subscriptions.service", () => ({
  hasValidSubscription: (tenantId: string) => hasValidSubscription(tenantId),
}));

const TENANT = "11111111-1111-4111-8111-111111111111";

function call(overrides: Partial<Request> = {}) {
  const req = { tenantId: TENANT, ...overrides } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn> };
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

function session(isSuperAdmin: boolean) {
  return { user: { id: "u1", isSuperAdmin } } as unknown as Request["session"];
}

describe("requireSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a paid tenant through", async () => {
    hasValidSubscription.mockResolvedValue([null, true]);
    const { req, res, next } = call({ session: session(false) });

    await requireSubscription(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("answers 402 for an unpaid tenant", async () => {
    hasValidSubscription.mockResolvedValue([null, false]);
    const { req, res, next } = call({ session: session(false) });

    await requireSubscription(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  // A superadmin's active tenant is usually somebody else's organization, and
  // they are not the one who can pay for it.
  it("lets a superadmin through an unpaid tenant without looking it up", async () => {
    hasValidSubscription.mockResolvedValue([null, false]);
    const { req, res, next } = call({ session: session(true) });

    await requireSubscription(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(hasValidSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when the lookup fails", async () => {
    hasValidSubscription.mockResolvedValue([{ reason: "UNKNOWN_ERROR" }, null]);
    const { req, res, next } = call({ session: session(false) });

    await requireSubscription(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a request with no tenant", async () => {
    const { req, res, next } = call({ session: session(false), tenantId: undefined });

    await requireSubscription(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
