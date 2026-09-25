import * as x509 from "@peculiar/x509";
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  type DeviceDb,
  getDeviceConfigurationService,
  isCommandOpen,
  recordCommandResultService,
  recordDeviceEventService,
  recordDeviceEventsService,
  renewCertificateService,
} from "@/api/services/device.service";
import { type CertificateAuthority, createCertificateAuthority } from "@/lib/pki";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const OTHER_CERT_ID = "cert-belonging-to-someone-else";

const machine = { id: MACHINE, tenantId: TENANT, siteId: SITE, certificateId: "cert-1" };

function fakeDb(overrides: Record<string, unknown> = {}) {
  const db = {
    machineConfiguration: {
      findFirst: vi.fn(async (_args: unknown) => ({ version: 3, payload: { version: 1, slots: [] } })),
    },
    machineCommand: {
      findFirst: vi.fn(async (_args: unknown) => ({ id: "cmd-row", commandId: "cmd-9281", status: "sent" })),
      update: vi.fn(async (_args: unknown) => ({})),
    },
    machineEvent: { create: vi.fn(async (_args: unknown) => ({})) },
    machineCertificate: {
      create: vi.fn(async (_args: unknown) => ({})),
      update: vi.fn(async (_args: unknown) => ({})),
    },
    ...overrides,
  };
  // Assigned after the override merge, so it always closes over whatever
  // `db.machineCommand.update` / `db.machineEvent.create` /
  // `db.machineCertificate.{create,update}` ended up being (default or
  // overridden) — a test overriding one of those still sees it called,
  // whether the service reaches it through `tx` inside `$transaction` or
  // (if a mutation removes the wrapper) directly on `db`.
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      machineCommand: { update: db.machineCommand.update },
      machineEvent: { create: db.machineEvent.create },
      machineCertificate: { create: db.machineCertificate.create, update: db.machineCertificate.update },
    }),
  );
  (db as Record<string, unknown>).$transaction = transaction;
  return db as unknown as DeviceDb & typeof db;
}

describe("getDeviceConfigurationService", () => {
  it("answers the highest version for the machine", async () => {
    const db = fakeDb();

    const [error, result] = await getDeviceConfigurationService(db, machine);

    expect(error).toBeNull();
    expect(result).toEqual({ version: 3, payload: { version: 1, slots: [] } });
  });

  it("scopes the read to the machine behind the certificate", async () => {
    const db = fakeDb();
    await getDeviceConfigurationService(db, machine);

    const args = db.machineConfiguration.findFirst.mock.calls[0][0] as { where: { machineId: string } };
    expect(args.where.machineId).toBe(MACHINE);
  });

  it("answers CONFIGURATION_NOT_FOUND when none has been published", async () => {
    const db = fakeDb({ machineConfiguration: { findFirst: vi.fn(async () => null) } });

    const [error] = await getDeviceConfigurationService(db, machine);

    expect(error?.reason).toBe("CONFIGURATION_NOT_FOUND");
  });
});

describe("isCommandOpen", () => {
  it("is open for pending", () => {
    expect(isCommandOpen("pending")).toBe(true);
  });

  it("is open for sent", () => {
    expect(isCommandOpen("sent")).toBe(true);
  });

  it("is closed for completed", () => {
    expect(isCommandOpen("completed")).toBe(false);
  });

  it("is closed for failed", () => {
    expect(isCommandOpen("failed")).toBe(false);
  });

  it("is closed for expired", () => {
    expect(isCommandOpen("expired")).toBe(false);
  });
});

describe("recordCommandResultService", () => {
  it("completes a command that belongs to this machine", async () => {
    const db = fakeDb();

    const [error] = await recordCommandResultService(db, machine, {
      commandId: "cmd-9281",
      status: "completed",
    });

    expect(error).toBeNull();
    expect(db.machineCommand.update).toHaveBeenCalled();
  });

  it("applies a result to a command that is still pending, not only sent", async () => {
    const db = fakeDb({
      machineCommand: {
        findFirst: vi.fn(async () => ({ id: "cmd-row", commandId: "cmd-9281", status: "pending" })),
        update: vi.fn(async () => ({})),
      },
    });

    const [error, result] = await recordCommandResultService(db, machine, {
      commandId: "cmd-9281",
      status: "completed",
    });

    expect(error).toBeNull();
    expect(result).toEqual({ applied: true });
    expect(db.machineCommand.update).toHaveBeenCalled();
  });

  it("looks the command up by id AND machine, never by id alone", async () => {
    const db = fakeDb();
    await recordCommandResultService(db, machine, { commandId: "cmd-9281", status: "completed" });

    const args = db.machineCommand.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ commandId: "cmd-9281", machineId: MACHINE });
  });

  it("answers COMMAND_NOT_FOUND for another machine's command", async () => {
    const db = fakeDb({ machineCommand: { findFirst: vi.fn(async () => null), update: vi.fn() } });

    const [error] = await recordCommandResultService(db, machine, {
      commandId: "cmd-9281",
      status: "completed",
    });

    expect(error?.reason).toBe("COMMAND_NOT_FOUND");
  });

  it("ignores a result for a command that is already finished", async () => {
    const db = fakeDb({
      machineCommand: {
        findFirst: vi.fn(async () => ({ id: "cmd-row", commandId: "cmd-9281", status: "completed" })),
        update: vi.fn(),
      },
    });

    const [error, result] = await recordCommandResultService(db, machine, {
      commandId: "cmd-9281",
      status: "failed",
    });

    expect(error).toBeNull();
    expect(result).toEqual({ applied: false });
    expect(db.machineCommand.update).not.toHaveBeenCalled();
  });

  it("does not write a MachineEvent when a replayed result is ignored", async () => {
    const db = fakeDb({
      machineCommand: {
        findFirst: vi.fn(async () => ({ id: "cmd-row", commandId: "cmd-9281", status: "completed" })),
        update: vi.fn(),
      },
    });

    await recordCommandResultService(db, machine, { commandId: "cmd-9281", status: "failed" });

    expect(db.machineEvent.create).not.toHaveBeenCalled();
  });

  it("writes a setup-confirmed MachineEvent when the result is completed", async () => {
    const db = fakeDb();

    await recordCommandResultService(db, machine, { commandId: "cmd-9281", status: "completed" });

    const args = db.machineEvent.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ type: "setup-confirmed" });
  });

  it("writes a setup-failed MachineEvent when the result is failed", async () => {
    const db = fakeDb();

    await recordCommandResultService(db, machine, { commandId: "cmd-9281", status: "failed" });

    const args = db.machineEvent.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ type: "setup-failed" });
  });

  it("stamps the written event with the machine's own tenant and id, never the body's", async () => {
    const db = fakeDb();

    // The body carries no tenant/machine id at all — this proves the
    // event is stamped from the verified `machine` context, not from input.
    await recordCommandResultService(db, machine, { commandId: "cmd-9281", status: "completed" });

    const args = db.machineEvent.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ machineId: MACHINE, tenantId: TENANT });
    expect(args.data.tenantId).not.toBe(OTHER_TENANT);
  });

  it("wraps the command update and the event write in a single transaction", async () => {
    const db = fakeDb();

    await recordCommandResultService(db, machine, { commandId: "cmd-9281", status: "completed" });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failing event write as UNKNOWN_ERROR rather than a false success", async () => {
    const db = fakeDb({ machineEvent: { create: vi.fn(async () => { throw new Error("event store down"); }) } });

    const [error, result] = await recordCommandResultService(db, machine, {
      commandId: "cmd-9281",
      status: "completed",
    });

    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(result).toBeNull();
  });

  it("surfaces a failing command update as UNKNOWN_ERROR rather than a false success", async () => {
    const db = fakeDb({ machineCommand: { findFirst: vi.fn(async () => ({ id: "cmd-row", commandId: "cmd-9281", status: "sent" })), update: vi.fn(async () => { throw new Error("db down"); }) } });

    const [error] = await recordCommandResultService(db, machine, { commandId: "cmd-9281", status: "completed" });

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });

  it("does not leave the command closed when the transaction's event write fails, so a retry can still succeed", async () => {
    // A real Postgres transaction rolls the whole callback back on a throw —
    // nothing it wrote is visible afterwards. A mock has no such engine, so
    // this fixture reproduces exactly the property the service depends on:
    // the update is only durable if the transaction's callback returns
    // without throwing.
    let row = { id: "cmd-row", commandId: "cmd-9281", status: "sent" };
    const findFirst = vi.fn(async () => ({ ...row }));
    const update = vi.fn(async (args: { data: { status: string } }) => {
      row = { ...row, status: args.data.status };
      return row;
    });
    const create = vi.fn(async (_args: unknown) => ({}));
    create.mockRejectedValueOnce(new Error("event store down"));

    const db = fakeDb({ machineCommand: { findFirst, update } });
    db.machineEvent.create = create;
    const before = { ...row };
    db.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      try {
        return await fn({ machineCommand: { update }, machineEvent: { create } });
      } catch (error) {
        row = before; // rollback: the tentative status change never survives
        throw error;
      }
    }) as unknown as typeof db.$transaction;

    const [firstError] = await recordCommandResultService(db, machine, {
      commandId: "cmd-9281",
      status: "completed",
    });

    expect(firstError?.reason).toBe("UNKNOWN_ERROR");
    expect(row.status).toBe("sent"); // rolled back, still open

    const [secondError, secondResult] = await recordCommandResultService(db, machine, {
      commandId: "cmd-9281",
      status: "completed",
    });

    expect(secondError).toBeNull();
    expect(secondResult).toEqual({ applied: true });
    expect(row.status).toBe("completed");
  });
});

describe("recordDeviceEventService", () => {
  it("stamps the event with the machine's own tenant", async () => {
    const db = fakeDb();

    await recordDeviceEventService(db, machine, {
      type: "door-opened",
      payload: {},
      occurredAt: new Date().toISOString(),
    });

    const args = db.machineEvent.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ machineId: MACHINE, tenantId: TENANT });
  });

  it("treats a duplicate eventId as already stored rather than an error", async () => {
    const duplicate = Object.assign(new Error("unique"), { code: "P2002" });
    const db = fakeDb({ machineEvent: { create: vi.fn(async () => { throw duplicate; }) } });

    const [error, result] = await recordDeviceEventService(db, machine, {
      type: "door-opened",
      payload: {},
      eventId: "evt-10982",
      occurredAt: new Date().toISOString(),
    });

    expect(error).toBeNull();
    expect(result).toEqual({ stored: false });
  });

  it("surfaces a non-P2002 error as UNKNOWN_ERROR rather than swallowing it as already-stored", async () => {
    const plain = new Error("connection reset");
    const db = fakeDb({ machineEvent: { create: vi.fn(async () => { throw plain; }) } });

    const [error, result] = await recordDeviceEventService(db, machine, {
      type: "door-opened",
      payload: {},
      eventId: "evt-10982",
      occurredAt: new Date().toISOString(),
    });

    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(result).toBeNull();
  });

  // A machine's id is not secret, and eventId is "<machine_id>-<seq>". If the
  // device-supplied value were stored verbatim, a compromised machine could
  // POST an eventId equal to a victim machine's, and skipDuplicates on the
  // batch path would then silently discard the victim's real events forever.
  it("cannot suppress another machine's events: the same device-supplied eventId is namespaced per machine", async () => {
    const otherMachine = {
      id: "44444444-4444-4444-8444-444444444444",
      tenantId: OTHER_TENANT,
      siteId: SITE,
      certificateId: "cert-2",
    };
    const dbA = fakeDb();
    const dbB = fakeDb();

    await recordDeviceEventService(dbA, machine, {
      type: "door-released",
      payload: {},
      eventId: "shared-victim-id",
      occurredAt: new Date().toISOString(),
    });
    await recordDeviceEventService(dbB, otherMachine, {
      type: "door-released",
      payload: {},
      eventId: "shared-victim-id",
      occurredAt: new Date().toISOString(),
    });

    const storedA = (dbA.machineEvent.create.mock.calls[0][0] as { data: { eventId: string } }).data.eventId;
    const storedB = (dbB.machineEvent.create.mock.calls[0][0] as { data: { eventId: string } }).data.eventId;

    expect(storedA).not.toBe(storedB);
    expect(storedA).toBe(`${MACHINE}:shared-victim-id`);
    expect(storedB).toBe(`${otherMachine.id}:shared-victim-id`);
  });

  it("leaves eventId undefined when the device sends none, rather than namespacing an empty string", async () => {
    const db = fakeDb();

    await recordDeviceEventService(db, machine, {
      type: "door-opened",
      payload: {},
      occurredAt: new Date().toISOString(),
    });

    const args = db.machineEvent.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data.eventId).toBeUndefined();
  });
});

describe("recordDeviceEventsService", () => {
  const events = [
    { type: "door-released", payload: { source: "keypad" }, eventId: `${MACHINE}-1`, sequenceNumber: 1, occurredAt: "2026-09-21T10:00:00.000Z" },
    { type: "door-released", payload: { source: "keypad" }, eventId: `${MACHINE}-2`, sequenceNumber: 2, occurredAt: "2026-09-21T10:05:00.000Z" },
  ];

  it("stores every event against the machine from the certificate", async () => {
    const createMany = vi.fn(async (_args: unknown) => ({ count: 2 }));
    const db = { ...fakeDb(), machineEvent: { create: vi.fn(), createMany } } as unknown as DeviceDb;

    const [error, result] = await recordDeviceEventsService(db, machine, events);

    expect(error).toBeNull();
    expect(result).toEqual({ received: 2, stored: 2 });
    const args = createMany.mock.calls[0][0] as { data: { machineId: string; tenantId: string }[] };
    expect(args.data.every((row) => row.machineId === MACHINE && row.tenantId === TENANT)).toBe(true);
  });

  // The device retries a batch whose response it never saw. That must be free.
  it("reports the duplicates it skipped rather than failing", async () => {
    const createMany = vi.fn(async (_args: unknown) => ({ count: 0 }));
    const db = { ...fakeDb(), machineEvent: { create: vi.fn(), createMany } } as unknown as DeviceDb;

    const [error, result] = await recordDeviceEventsService(db, machine, events);

    expect(error).toBeNull();
    expect(result).toEqual({ received: 2, stored: 0 });
  });

  it("returns UNKNOWN_ERROR when the write fails", async () => {
    const createMany = vi.fn(async (_args: unknown) => {
      throw new Error("connection lost");
    });
    const db = { ...fakeDb(), machineEvent: { create: vi.fn(), createMany } } as unknown as DeviceDb;

    const [error] = await recordDeviceEventsService(db, machine, events);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });

  // Same attack as the single-event path's equivalent test: without
  // namespacing, a compromised machine could send a batch whose eventIds
  // equal a victim's, and skipDuplicates would discard the victim's real
  // events forever while this machine's own rows are stored under its own
  // machineId. The fix must apply here too, or the batch path stays exploitable
  // even after the single-event path is fixed.
  it("cannot suppress another machine's events: the same device-supplied eventIds are namespaced per machine", async () => {
    const otherMachine = {
      id: "44444444-4444-4444-8444-444444444444",
      tenantId: OTHER_TENANT,
      siteId: SITE,
      certificateId: "cert-2",
    };
    const shared = [
      { type: "door-released", payload: {}, eventId: "shared-victim-id", occurredAt: "2026-09-21T10:00:00.000Z" },
    ];

    const createManyA = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const dbA = { ...fakeDb(), machineEvent: { create: vi.fn(), createMany: createManyA } } as unknown as DeviceDb;
    const createManyB = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const dbB = { ...fakeDb(), machineEvent: { create: vi.fn(), createMany: createManyB } } as unknown as DeviceDb;

    await recordDeviceEventsService(dbA, machine, shared);
    await recordDeviceEventsService(dbB, otherMachine, shared);

    const storedA = (createManyA.mock.calls[0][0] as { data: { eventId: string }[] }).data[0].eventId;
    const storedB = (createManyB.mock.calls[0][0] as { data: { eventId: string }[] }).data[0].eventId;

    expect(storedA).not.toBe(storedB);
    expect(storedA).toBe(`${MACHINE}:shared-victim-id`);
    expect(storedB).toBe(`${otherMachine.id}:shared-victim-id`);
  });

  // The device falls back from a rejected/unacknowledged batch to single
  // posts of the same records. That fallback is only safe if both paths
  // namespace the same (machine, device eventId) pair to the identical
  // stored value, or the retried event would be stored twice.
  it("derives the same stored eventId on the single and batch paths, so the batch-to-single fallback still dedupes", async () => {
    const dbSingle = fakeDb();
    const createMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const dbBatch = { ...fakeDb(), machineEvent: { create: vi.fn(), createMany } } as unknown as DeviceDb;

    await recordDeviceEventService(dbSingle, machine, {
      type: "door-released",
      payload: {},
      eventId: "evt-77",
      occurredAt: "2026-09-21T10:00:00.000Z",
    });
    await recordDeviceEventsService(dbBatch, machine, [
      { type: "door-released", payload: {}, eventId: "evt-77", occurredAt: "2026-09-21T10:00:00.000Z" },
    ]);

    const singleEventId = (dbSingle.machineEvent.create.mock.calls[0][0] as { data: { eventId: string } }).data
      .eventId;
    const batchEventId = (createMany.mock.calls[0][0] as { data: { eventId: string }[] }).data[0].eventId;

    expect(singleEventId).toBe(batchEventId);
  });

  // The single-event path already proves identifiers come from the verified
  // machine context, never the body (see "stamps the written event with the
  // machine's own tenant and id" above, exercised via recordCommandResultService).
  // The batch path had no equivalent: this proves a hostile machineId/tenantId
  // riding along on an event object is ignored, and every stored row is
  // stamped from `machine`, not from the input.
  it("stamps every event with the machine's own tenant and id, never the body's, even when the body carries hostile fields", async () => {
    const createMany = vi.fn(async (_args: unknown) => ({ count: 2 }));
    const db = { ...fakeDb(), machineEvent: { create: vi.fn(), createMany } } as unknown as DeviceDb;
    const hostileEvents = events.map((event) => ({
      ...event,
      machineId: "11111111-2222-3333-4444-555555555555",
      tenantId: OTHER_TENANT,
    })) as unknown as typeof events;

    const [error, result] = await recordDeviceEventsService(db, machine, hostileEvents);

    expect(error).toBeNull();
    expect(result).toEqual({ received: 2, stored: 2 });
    const args = createMany.mock.calls[0][0] as { data: { machineId: string; tenantId: string }[] };
    expect(args.data.every((row) => row.machineId === MACHINE && row.tenantId === TENANT)).toBe(true);
    expect(args.data.some((row) => row.tenantId === OTHER_TENANT)).toBe(false);
  });
});

describe("renewCertificateService", () => {
  let ca: CertificateAuthority;
  let csr: string;

  beforeAll(async () => {
    ca = (await createCertificateAuthority()).ca;
    const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    csr = (
      await x509.Pkcs10CertificateRequestGenerator.create({
        name: "CN=irrelevant-the-service-ignores-this",
        keys,
        signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
      })
    ).toString("pem");
  });

  it("issues a certificate signed for this machine's own id, never the CSR's own subject", async () => {
    const db = fakeDb();

    const [error, result] = await renewCertificateService(db, ca, machine, csr);

    expect(error).toBeNull();
    expect(result?.certificate).toContain("BEGIN CERTIFICATE");
    const issued = new x509.X509Certificate(result!.certificate);
    expect(issued.subject).toContain(`CN=${MACHINE}`);
  });

  it("writes the new certificate row before revoking the old one", async () => {
    const db = fakeDb();

    await renewCertificateService(db, ca, machine, csr);

    const createdAt = db.machineCertificate.create.mock.invocationCallOrder[0];
    const revokedAt = db.machineCertificate.update.mock.invocationCallOrder[0];
    expect(createdAt).toBeLessThan(revokedAt);
  });

  it("revokes the certificate named by this machine's own credential, never one from the request", async () => {
    const db = fakeDb();

    await renewCertificateService(db, ca, machine, csr);

    const args = db.machineCertificate.update.mock.calls[0][0] as { where: { id: string } };
    expect(args.where.id).toBe(machine.certificateId);
    expect(args.where.id).not.toBe(OTHER_CERT_ID);
  });

  it("rejects a malformed CSR without writing or revoking any certificate", async () => {
    const db = fakeDb();

    const [error] = await renewCertificateService(
      db,
      ca,
      machine,
      "-----BEGIN CERTIFICATE REQUEST-----\nnope\n-----END CERTIFICATE REQUEST-----",
    );

    expect(error?.reason).toBe("CSR_REJECTED");
    expect(db.machineCertificate.create).not.toHaveBeenCalled();
    expect(db.machineCertificate.update).not.toHaveBeenCalled();
  });

  it("wraps the new-row create and the old-row revoke in a single transaction", async () => {
    const db = fakeDb();

    await renewCertificateService(db, ca, machine, csr);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failing revoke as UNKNOWN_ERROR rather than a false success", async () => {
    const db = fakeDb({ machineCertificate: { update: vi.fn(async () => { throw new Error("db down"); }) } });

    const [error] = await renewCertificateService(db, ca, machine, csr);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });

  it("leaves no new certificate row when the revoke inside the transaction fails", async () => {
    // Same rollback-fixture pattern as the command-result transaction test:
    // a mock has no real transaction engine, so this reproduces the property
    // the service depends on — nothing the callback wrote survives a throw.
    let certificates: Array<{ id: string }> = [{ id: machine.certificateId }];
    const create = vi.fn(async (_args: unknown) => {
      certificates = [...certificates, { id: "new-cert-row" }];
      return {};
    });
    const update = vi.fn(async (_args: unknown) => {
      throw new Error("db down");
    });

    const db = fakeDb({ machineCertificate: { create, update } });
    const before = [...certificates];
    db.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      try {
        return await fn({ machineCertificate: { create, update } });
      } catch (error) {
        certificates = before; // rollback: the new row never survives a failed revoke
        throw error;
      }
    }) as unknown as typeof db.$transaction;

    const [error] = await renewCertificateService(db, ca, machine, csr);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(certificates).toEqual(before);
  });
});
