import { hash } from "@node-rs/argon2";
import * as x509 from "@peculiar/x509";
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { type ActivateDb, activateMachineService } from "@/api/services/activation.service";
import { type CertificateAuthority, createCertificateAuthority } from "@/lib/pki";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const CODE = "ABCDEFGHJKLM";

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
      name: `CN=${MACHINE}`,
      keys,
      signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    })
  ).toString("pem");
});

type ActivationRow = {
  id: string;
  machineId: string;
  tenantId: string;
  siteId: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
};

async function liveActivation(overrides: Partial<ActivationRow> = {}): Promise<ActivationRow> {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    machineId: MACHINE,
    tenantId: TENANT,
    siteId: SITE,
    codeHash: await hash(CODE),
    expiresAt: new Date(Date.now() + 600_000),
    usedAt: null,
    attempts: 0,
    ...overrides,
  };
}

function fakeDb(activation: ActivationRow | null, machine = { id: MACHINE, disabledAt: null as Date | null }) {
  const commit = vi.fn(async (_args: unknown) => ({ count: 1 }));
  const db = {
    machineActivation: {
      findFirst: vi.fn(async () => activation),
      update: vi.fn(async () => activation),
      updateMany: commit,
    },
    machine: { findUnique: vi.fn(async () => machine), update: vi.fn(async () => machine) },
    machineCertificate: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        machineActivation: { updateMany: commit },
        machine: { update: vi.fn(async () => machine) },
        machineCertificate: { create: vi.fn(async () => ({})) },
      }),
    ),
  };
  return { db: db as unknown as ActivateDb & typeof db, commit };
}

describe("activateMachineService", () => {
  it("issues a certificate and the machine's connection details", async () => {
    const { db } = fakeDb(await liveActivation());

    const [error, data] = await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(error).toBeNull();
    expect(data?.certificate).toContain("BEGIN CERTIFICATE");
    expect(data?.caCertificate).toContain("BEGIN CERTIFICATE");
    expect(data?.topicPrefix).toBe(`v1/${TENANT}/${SITE}/${MACHINE}`);
    expect(data?.mqtt.port).toBeGreaterThan(0);
  });

  it("marks the activation used, so the code works exactly once", async () => {
    const { db, commit } = fakeDb(await liveActivation());

    await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(commit).toHaveBeenCalled();
    const where = (commit.mock.calls[0][0] as { where: { id: string; usedAt: null } }).where;
    // Guarded on both the specific row id and usedAt still being null: without
    // the id, the guard would spend every pending activation row in the
    // database, not just this one.
    expect(where.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(where.usedAt).toBeNull();
  });

  it("rejects a wrong code", async () => {
    const { db } = fakeDb(await liveActivation());

    const [error] = await activateMachineService(db, ca, { machineId: MACHINE, code: "WRONGWRONG12", csr });

    expect(error?.reason).toBe("ACTIVATION_CODE_INVALID");
  });

  it("counts a failed attempt", async () => {
    const { db } = fakeDb(await liveActivation());

    await activateMachineService(db, ca, { machineId: MACHINE, code: "WRONGWRONG12", csr });

    expect(db.machineActivation.update).toHaveBeenCalled();
  });

  it("rejects an expired code", async () => {
    const { db } = fakeDb(await liveActivation({ expiresAt: new Date(Date.now() - 1000) }));

    const [error] = await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(error?.reason).toBe("ACTIVATION_EXPIRED");
  });

  it("rejects a code that was already used", async () => {
    const { db } = fakeDb(await liveActivation({ usedAt: new Date() }));

    const [error] = await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(error?.reason).toBe("ACTIVATION_CODE_INVALID");
  });

  it("rejects once too many attempts have been made", async () => {
    const { db } = fakeDb(await liveActivation({ attempts: 10 }));

    const [error] = await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(error?.reason).toBe("ACTIVATION_ATTEMPTS_EXCEEDED");
  });

  it("rejects when there is no activation at all", async () => {
    const { db } = fakeDb(null);

    const [error] = await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(error?.reason).toBe("ACTIVATION_CODE_INVALID");
  });

  it("rejects a malformed CSR", async () => {
    const { db } = fakeDb(await liveActivation());

    const [error] = await activateMachineService(db, ca, {
      machineId: MACHINE,
      code: CODE,
      csr: "-----BEGIN CERTIFICATE REQUEST-----\nnope\n-----END CERTIFICATE REQUEST-----",
    });

    expect(error?.reason).toBe("CSR_REJECTED");
  });

  it("rejects a disabled machine", async () => {
    const { db } = fakeDb(await liveActivation(), { id: MACHINE, disabledAt: new Date() });

    const [error] = await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(error?.reason).toBe("MACHINE_DISABLED");
  });

  it("answers ACTIVATION_COMMIT_FAILED when the commit updates no row", async () => {
    const { db } = fakeDb(await liveActivation());
    db.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        machineActivation: { updateMany: vi.fn(async () => ({ count: 0 })) },
        machine: { update: vi.fn(async () => ({})) },
        machineCertificate: { create: vi.fn(async () => ({})) },
      }),
    ) as never;

    const [error] = await activateMachineService(db, ca, { machineId: MACHINE, code: CODE, csr });

    expect(error?.reason).toBe("ACTIVATION_COMMIT_FAILED");
  });
});
