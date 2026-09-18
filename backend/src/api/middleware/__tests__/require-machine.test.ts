import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { type MachineLookupDb, requireMachine, resolveMachineCertificate } from "@/api/middleware/require-machine";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";

type CertRow = {
  id: string;
  machineId: string;
  notAfter: Date;
  machine: { id: string; tenantId: string | null; siteId: string | null; disabledAt: Date | null };
};

function certRow(overrides: Partial<CertRow> = {}): CertRow {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    machineId: MACHINE,
    notAfter: new Date(Date.now() + 86_400_000),
    machine: { id: MACHINE, tenantId: TENANT, siteId: SITE, disabledAt: null },
    ...overrides,
  };
}

function fakeDb(row: CertRow | null) {
  const db = { machineCertificate: { findFirst: vi.fn(async (_args: unknown) => row) } };
  return db as unknown as MachineLookupDb & typeof db;
}

describe("resolveMachineCertificate", () => {
  it("resolves a live certificate to its machine", async () => {
    const context = await resolveMachineCertificate(fakeDb(certRow()), "0a1b2c");

    expect(context).toEqual({
      id: MACHINE,
      tenantId: TENANT,
      siteId: SITE,
      certificateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("queries only for a certificate that has not been revoked", async () => {
    const db = fakeDb(certRow());
    await resolveMachineCertificate(db, "0a1b2c");

    const where = (db.machineCertificate.findFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ serial: "0a1b2c", revokedAt: null });
  });

  it("refuses an unknown serial", async () => {
    expect(await resolveMachineCertificate(fakeDb(null), "0a1b2c")).toBeNull();
  });

  it("refuses a disabled machine", async () => {
    const row = certRow();
    row.machine.disabledAt = new Date();
    expect(await resolveMachineCertificate(fakeDb(row), "0a1b2c")).toBeNull();
  });

  it("refuses an expired certificate", async () => {
    const row = certRow({ notAfter: new Date(Date.now() - 1000) });
    expect(await resolveMachineCertificate(fakeDb(row), "0a1b2c")).toBeNull();
  });

  it("refuses a machine that has no tenant", async () => {
    const row = certRow();
    row.machine.tenantId = null;
    expect(await resolveMachineCertificate(fakeDb(row), "0a1b2c")).toBeNull();
  });

  it("refuses a machine that has no site", async () => {
    const row = certRow();
    row.machine.siteId = null;
    expect(await resolveMachineCertificate(fakeDb(row), "0a1b2c")).toBeNull();
  });
});

function call(headers: Record<string, string | string[]>) {
  const req = { headers } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn> };
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("requireMachine", () => {
  it("rejects a request with no proxy headers", async () => {
    const { req, res, next } = call({});

    await requireMachine(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a forged serial when the proxy did not verify a certificate", async () => {
    const { req, res, next } = call({ "x-client-serial": "0a1b2c" });

    await requireMachine(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when the proxy reports a failed verification", async () => {
    const { req, res, next } = call({ "x-client-verify": "FAILED:expired", "x-client-serial": "0a1b2c" });

    await requireMachine(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an explicit NONE verification result", async () => {
    const { req, res, next } = call({ "x-client-verify": "NONE", "x-client-serial": "0a1b2c" });

    await requireMachine(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an empty verification header", async () => {
    const { req, res, next } = call({ "x-client-verify": "", "x-client-serial": "0a1b2c" });

    await requireMachine(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a repeated x-client-verify header (Express represents it as string[])", async () => {
    const { req, res, next } = call({ "x-client-verify": ["SUCCESS", "SUCCESS"], "x-client-serial": "0a1b2c" });

    await requireMachine(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
