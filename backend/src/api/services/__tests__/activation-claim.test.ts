import { verify } from "@node-rs/argon2";
import { describe, expect, it, vi } from "vitest";

import { type ClaimDb, claimMachineService, generateOneTimeCode } from "@/api/services/activation.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const input = { tenantId: TENANT, siteId: SITE, serialNumber: "SN-0001", userId: USER };

type MachineRow = {
  id: string;
  registrationStatus: "unregistered" | "claimed" | "permanent_locked";
  tenantId: string | null;
};

/**
 * Evaluates the exact `where` shape the transaction's conditional write uses
 * ({ id, OR: [ {registrationStatus, tenantId?}, ... ] }) against a machine row,
 * so a test can drive the atomic backstop directly rather than mocking its
 * count. A clause with `tenantId` absent matches any tenant for that status;
 * a clause with `tenantId` present must match the row's tenantId (including
 * null). This mirrors Prisma's semantics for these two field filters.
 */
function whereMatches(where: any, row: MachineRow): boolean {
  if (where.id !== row.id) return false;
  const clauses: any[] = where.OR ?? [where];
  return clauses.some((clause) => {
    if (clause.registrationStatus !== undefined && clause.registrationStatus !== row.registrationStatus) {
      return false;
    }
    if ("tenantId" in clause && clause.tenantId !== row.tenantId) return false;
    return true;
  });
}

function fakeDb(
  machine: MachineRow | null,
  site: { id: string; tenantId: string } | null = { id: SITE, tenantId: TENANT },
  claimUpdateCount?: number,
  // The machine's state at write time, which the transaction's conditional
  // write evaluates its `where` against. Defaults to the pre-check row, so an
  // uncontested claim behaves as before.
  writeMachine: MachineRow | null = machine,
) {
  const tx = {
    machine: {
      updateMany: vi.fn(async (args: { where: any }) => ({
        // An explicit override still forces the count (used to simulate a lost
        // race); otherwise the where is genuinely evaluated against the row.
        count:
          claimUpdateCount !== undefined
            ? claimUpdateCount
            : writeMachine && whereMatches(args.where, writeMachine)
              ? 1
              : 0,
      })),
    },
    machineActivation: {
      updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
      create: vi.fn(async (_args: { data: { codeHash: string } }) => ({})),
    },
  };
  const db = {
    machine: { findUnique: vi.fn(async () => machine) },
    site: { findFirst: vi.fn(async () => site) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  return Object.assign(db, { tx }) as unknown as ClaimDb & typeof db & { tx: typeof tx };
}

describe("generateOneTimeCode", () => {
  it("produces eight digits", () => {
    // Digits only, so each character is one key press on the machine's keypad
    // rather than three or four in a character picker.
    const code = generateOneTimeCode();
    expect(code).toMatch(/^[0-9]{8}$/);
  });

  it("uses every digit", () => {
    // A weak check, and deliberately so: it catches an alphabet mistake that
    // locks digits out entirely. It does not prove the digits are uniform.
    const seen = new Set(Array.from({ length: 400 }, generateOneTimeCode).join(""));
    expect(seen.size).toBe(10);
  });

  it("does not repeat", () => {
    const codes = new Set(Array.from({ length: 200 }, generateOneTimeCode));
    expect(codes.size).toBe(200);
  });
});

describe("claimMachineService", () => {
  it("claims an unregistered machine and answers a code", async () => {
    const db = fakeDb({ id: MACHINE, registrationStatus: "unregistered", tenantId: null });

    const [error, result] = await claimMachineService(db, input);

    expect(error).toBeNull();
    expect(result?.machineId).toBe(MACHINE);
    expect(result?.oneTimeCode).toMatch(/^[0-9]{8}$/);
    expect(result?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("stores only the hash of the code, never the code", async () => {
    const db = fakeDb({ id: MACHINE, registrationStatus: "unregistered", tenantId: null });

    const [, result] = await claimMachineService(db, input);

    const created = db.tx.machineActivation.create.mock.calls[0][0];
    expect(JSON.stringify(created)).not.toContain(result!.oneTimeCode);
    expect(created.data.codeHash).toBeTruthy();
    expect(created.data.codeHash).not.toBe(result!.oneTimeCode);
    // A plain difference from the code is not enough: base64, unsalted SHA-256,
    // or any other reversible/weak encoding would also differ. Require the
    // actual argon2id format and that it verifies against this exact code.
    expect(created.data.codeHash).toMatch(/^\$argon2id\$/);
    await expect(verify(created.data.codeHash, result!.oneTimeCode)).resolves.toBe(true);
  });

  it("answers MACHINE_NOT_FOUND for an unknown serial number", async () => {
    const [error] = await claimMachineService(fakeDb(null), input);
    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
  });

  it("answers MACHINE_ALREADY_CLAIMED for a locked machine", async () => {
    const db = fakeDb({ id: MACHINE, registrationStatus: "permanent_locked", tenantId: TENANT });

    const [error] = await claimMachineService(db, input);

    expect(error?.reason).toBe("MACHINE_ALREADY_CLAIMED");
  });

  it("re-issues a code for a machine claimed but not yet activated", async () => {
    const db = fakeDb({ id: MACHINE, registrationStatus: "claimed", tenantId: TENANT });

    const [error, result] = await claimMachineService(db, input);

    expect(error).toBeNull();
    expect(result?.oneTimeCode).toBeTruthy();
  });

  it("refuses to re-issue for a machine claimed by another tenant", async () => {
    const db = fakeDb({ id: MACHINE, registrationStatus: "claimed", tenantId: "55555555-5555-4555-8555-555555555555" });

    const [error] = await claimMachineService(db, input);

    expect(error?.reason).toBe("MACHINE_ALREADY_CLAIMED");
  });

  // C2 (cross-tenant takeover through claim). A machine can carry a tenant's id
  // while its status stays `unregistered`, so "unregistered" must NOT mean
  // "claimable by anyone".
  it("refuses to claim an unregistered machine owned by another tenant (pre-check)", async () => {
    const OTHER = "55555555-5555-4555-8555-555555555555";
    const db = fakeDb({ id: MACHINE, registrationStatus: "unregistered", tenantId: OTHER });

    const [error, result] = await claimMachineService(db, input);

    // Refused before the transaction ever runs.
    expect(error?.reason).toBe("MACHINE_ALREADY_CLAIMED");
    expect(result).toBeNull();
    expect(db.tx.machine.updateMany).not.toHaveBeenCalled();
  });

  it("claims a genuinely ownerless (tenantId null) unregistered machine", async () => {
    const db = fakeDb({ id: MACHINE, registrationStatus: "unregistered", tenantId: null });

    const [error, result] = await claimMachineService(db, input);

    expect(error).toBeNull();
    expect(result?.machineId).toBe(MACHINE);
  });

  it("refuses at the atomic write when a machine becomes another tenant's after the pre-check", async () => {
    const OTHER = "55555555-5555-4555-8555-555555555555";
    // Pre-check sees it ownerless (claimable); by write time another tenant
    // owns it. The transaction's conditional write is the backstop that must
    // still refuse, independently of the pre-check.
    const db = fakeDb(
      { id: MACHINE, registrationStatus: "unregistered", tenantId: null },
      undefined,
      undefined,
      { id: MACHINE, registrationStatus: "unregistered", tenantId: OTHER },
    );

    const [error, result] = await claimMachineService(db, input);

    expect(db.tx.machine.updateMany).toHaveBeenCalled();
    expect(error?.reason).toBe("MACHINE_ALREADY_CLAIMED");
    expect(result).toBeNull();
  });

  it("claims at the atomic write when the machine is still ownerless (backstop positive)", async () => {
    const db = fakeDb(
      { id: MACHINE, registrationStatus: "unregistered", tenantId: null },
      undefined,
      undefined,
      { id: MACHINE, registrationStatus: "unregistered", tenantId: null },
    );

    const [error, result] = await claimMachineService(db, input);

    expect(db.tx.machine.updateMany).toHaveBeenCalled();
    expect(error).toBeNull();
    expect(result?.machineId).toBe(MACHINE);
  });

  it("answers SITE_NOT_FOUND when the site is not the caller's", async () => {
    const db = fakeDb({ id: MACHINE, registrationStatus: "unregistered", tenantId: null }, null);

    const [error] = await claimMachineService(db, input);

    expect(error?.reason).toBe("SITE_NOT_FOUND");
  });

  it("answers MACHINE_ALREADY_CLAIMED when a concurrent claim wins the race", async () => {
    // The pre-transaction findUnique read still sees the machine as claimable,
    // but the conditional write inside the transaction loses (count 0),
    // simulating a second claim that committed first.
    const db = fakeDb({ id: MACHINE, registrationStatus: "unregistered", tenantId: null }, undefined, 0);

    const [error, result] = await claimMachineService(db, input);

    expect(error?.reason).toBe("MACHINE_ALREADY_CLAIMED");
    expect(result).toBeNull();
  });
});
