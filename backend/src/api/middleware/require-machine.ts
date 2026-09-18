import type { NextFunction, Request, Response } from "express";

import { prisma } from "@/lib/prisma";

/**
 * The HTTP twin of the EMQX authn webhook. Express trusts `X-Client-Verify`
 * and `X-Client-Serial` only because of two things holding together in
 * config/nginx.conf, and either one alone is not enough:
 *
 *   1. The :8443 listener verifies the client certificate against the CA and
 *      sets both headers unconditionally (`proxy_set_header`, not
 *      conditional), so a device cannot supply its own values there.
 *   2. The :80 listener — the plain, unauthenticated public listener — has no
 *      TLS at all, let alone mTLS, so it must never let a caller reach this
 *      middleware pretending to be a verified device. It blanks both headers
 *      unconditionally AND refuses `/api/device/*` outright (404), as
 *      defence in depth: blanking alone would still let a forged request
 *      reach Express (as an unverified one, but reaching it), and 404
 *      alone would leave nothing stopping a header forward if that location
 *      block were ever removed.
 *
 * A future edit that drops either half on :80 — the header-blanking or the
 * 404 — reopens mTLS bypass over plain HTTP, even though nothing on :8443
 * changed. See task-13-report.md for how this was found and fixed.
 *
 * The certificate proves which machine; this decides whether it may act.
 */

export type MachineContext = {
  id: string;
  tenantId: string;
  siteId: string;
  certificateId: string;
};

export type MachineLookupDb = {
  machineCertificate: { findFirst(args: unknown): Promise<unknown> };
};

declare global {
  namespace Express {
    interface Request {
      machine?: MachineContext;
    }
  }
}

export async function resolveMachineCertificate(
  db: MachineLookupDb,
  serial: string,
  now: Date = new Date(),
): Promise<MachineContext | null> {
  const certificate = (await db.machineCertificate.findFirst({
    where: { serial, revokedAt: null },
    select: {
      id: true,
      notAfter: true,
      machine: { select: { id: true, tenantId: true, siteId: true, disabledAt: true } },
    },
  })) as {
    id: string;
    notAfter: Date;
    machine: { id: string; tenantId: string | null; siteId: string | null; disabledAt: Date | null };
  } | null;

  if (!certificate) return null;
  if (certificate.notAfter.getTime() <= now.getTime()) return null;

  const { machine } = certificate;
  if (machine.disabledAt) return null;
  // An activated machine always has both. Without them there is no topic
  // prefix and no tenant to scope reads by, so there is nothing it may do.
  if (!machine.tenantId || !machine.siteId) return null;

  return {
    id: machine.id,
    tenantId: machine.tenantId,
    siteId: machine.siteId,
    certificateId: certificate.id,
  };
}

/** nginx normalises the serial differently across versions; compare lowercase. */
function readSerial(req: Request): string | null {
  const verify = req.headers["x-client-verify"];
  if (verify !== "SUCCESS") return null;

  const serial = req.headers["x-client-serial"];
  if (typeof serial !== "string" || serial.length === 0) return null;

  return serial.toLowerCase();
}

export async function requireMachine(req: Request, res: Response, next: NextFunction) {
  const serial = readSerial(req);
  if (!serial) {
    res.status(401).json({ error: "Client certificate required" });
    return;
  }

  const machine = await resolveMachineCertificate(prisma, serial);
  if (!machine) {
    res.status(401).json({ error: "Client certificate required" });
    return;
  }

  req.machine = machine;
  next();
}
