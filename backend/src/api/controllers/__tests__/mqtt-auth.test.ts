import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import type { MachineLookupDb } from "@/api/middleware/require-machine";
import { decideAuthn, decideAuthz, requireInternalSecret } from "@/api/controllers/mqtt-auth.controller";
import { config } from "@/lib/config";
import { buildTopicPrefix } from "@/mqtt/topics";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const SERIAL = "0a1b2c";
const PREFIX = buildTopicPrefix({ id: MACHINE, tenantId: TENANT, siteId: SITE });

function fakeDb(found = true) {
  const db = {
    machineCertificate: {
      findFirst: vi.fn(async () =>
        found
          ? {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              notAfter: new Date(Date.now() + 86_400_000),
              createdAt: new Date("2026-09-01T00:00:00Z"),
              machine: { id: MACHINE, tenantId: TENANT, siteId: SITE, disabledAt: null },
            }
          : null,
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return db as unknown as MachineLookupDb & typeof db;
}

const subject = `CN=${MACHINE}, OU=${SERIAL}, O=VMaaS`;

describe("decideAuthn", () => {
  it("allows a live certificate whose client id matches its common name", async () => {
    const result = await decideAuthn(fakeDb(), { clientid: MACHINE, cert_subject: subject });
    expect(result).toBe("allow");
  });

  it("denies a client id that is not the certificate's common name", async () => {
    const result = await decideAuthn(fakeDb(), { clientid: "someone-else", cert_subject: subject });
    expect(result).toBe("deny");
  });

  it("denies a revoked or unknown certificate", async () => {
    const result = await decideAuthn(fakeDb(false), { clientid: MACHINE, cert_subject: subject });
    expect(result).toBe("deny");
  });

  it("denies a subject with no serial in it", async () => {
    const result = await decideAuthn(fakeDb(), { clientid: MACHINE, cert_subject: `CN=${MACHINE}, O=VMaaS` });
    expect(result).toBe("deny");
  });

  it("denies a subject with no machine id (CN) in it, even if clientid collides with the missing value", async () => {
    // clientid strictly equals null here so the clientid-pinning check alone
    // cannot be the thing that denies this request — only the machineId
    // check can. A malicious payload could legitimately send a JSON `null`.
    const result = await decideAuthn(fakeDb(), {
      clientid: null as unknown as string,
      cert_subject: `OU=${SERIAL}, O=VMaaS`,
    });
    expect(result).toBe("deny");
  });

  it("denies a missing subject", async () => {
    expect(await decideAuthn(fakeDb(), { clientid: MACHINE, cert_subject: "" })).toBe("deny");
  });

  it("looks up the certificate by the lowercased serial", async () => {
    const db = fakeDb();
    await decideAuthn(db, { clientid: MACHINE, cert_subject: `CN=${MACHINE}, OU=${SERIAL.toUpperCase()}, O=VMaaS` });

    const where = (db.machineCertificate.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({ serial: SERIAL.toLowerCase() });
  });
});

describe("decideAuthz", () => {
  it("allows a machine to publish its own command results", async () => {
    const result = await decideAuthz(fakeDb(), {
      clientid: MACHINE,
      cert_subject: subject,
      action: "publish",
      topic: `${PREFIX}/command-results/cmd-1`,
    });
    expect(result).toBe("allow");
  });

  it("allows a machine to subscribe to its own commands", async () => {
    const result = await decideAuthz(fakeDb(), {
      clientid: MACHINE,
      cert_subject: subject,
      action: "subscribe",
      topic: `${PREFIX}/commands/apply-configuration`,
    });
    expect(result).toBe("allow");
  });

  it("denies publishing into another tenant's tree", async () => {
    const foreign = buildTopicPrefix({
      id: MACHINE,
      tenantId: "99999999-9999-4999-8999-999999999999",
      siteId: SITE,
    });
    const result = await decideAuthz(fakeDb(), {
      clientid: MACHINE,
      cert_subject: subject,
      action: "publish",
      topic: `${foreign}/command-results/cmd-1`,
    });
    expect(result).toBe("deny");
  });

  it("denies a machine subscribing to a channel it may only publish on", async () => {
    const result = await decideAuthz(fakeDb(), {
      clientid: MACHINE,
      cert_subject: subject,
      action: "subscribe",
      topic: `${PREFIX}/command-results/cmd-1`,
    });
    expect(result).toBe("deny");
  });

  it("denies an unknown action", async () => {
    // Uses a `commands` topic deliberately: that channel is subscribe-only,
    // so if the action check were missing, authorizeTopic's fallback branch
    // (anything that isn't literally "publish" is treated as "subscribe")
    // would wrongly allow this. A `command-results` topic would deny either
    // way and wouldn't tell the two code paths apart.
    const result = await decideAuthz(fakeDb(), {
      clientid: MACHINE,
      cert_subject: subject,
      action: "nonsense",
      topic: `${PREFIX}/commands/apply-configuration`,
    });
    expect(result).toBe("deny");
  });

  it("denies a missing topic", async () => {
    const result = await decideAuthz(fakeDb(), {
      clientid: MACHINE,
      cert_subject: subject,
      action: "publish",
      topic: undefined,
    });
    expect(result).toBe("deny");
  });

  it("denies a client id that does not match the certificate's common name", async () => {
    const result = await decideAuthz(fakeDb(), {
      clientid: "someone-else",
      cert_subject: subject,
      action: "publish",
      topic: `${PREFIX}/command-results/x`,
    });
    expect(result).toBe("deny");
  });

  it("denies when the certificate no longer resolves", async () => {
    const result = await decideAuthz(fakeDb(false), {
      clientid: MACHINE,
      cert_subject: subject,
      action: "publish",
      topic: `${PREFIX}/command-results/x`,
    });
    expect(result).toBe("deny");
  });
});

function mockReqRes(headers: Record<string, string>) {
  const req = { headers } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn> };
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("requireInternalSecret", () => {
  it("rejects a request with no shared secret", () => {
    const { req, res, next } = mockReqRes({});
    requireInternalSecret(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong shared secret", () => {
    const { req, res, next } = mockReqRes({ "x-internal-secret": "wrong-value" });
    requireInternalSecret(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("admits a request with the correct shared secret", () => {
    const { req, res, next } = mockReqRes({ "x-internal-secret": config.MQTT_INTERNAL_SECRET });
    requireInternalSecret(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("superseding older certificates", () => {
  it("happens when a machine connects", async () => {
    const db = fakeDb();
    await decideAuthn(db, { clientid: MACHINE, cert_subject: subject });
    expect(db.machineCertificate.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not happen on every publish or subscribe check", async () => {
    const db = fakeDb();
    await decideAuthz(db, { clientid: MACHINE, cert_subject: subject, action: "publish", topic: `${PREFIX}/events` });
    expect(db.machineCertificate.updateMany).not.toHaveBeenCalled();
  });
});
