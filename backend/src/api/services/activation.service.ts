import { hash, verify } from "@node-rs/argon2";
import { type Result, err, ok } from "@vmaas/shared/lib";
import { webcrypto } from "node:crypto";

import { config } from "../../lib/config";
import { type CertificateAuthority, signDeviceCsr } from "@/lib/pki";
import { buildTopicPrefix } from "@/mqtt/topics";

/**
 * Phase 1 of docs/image.png. The administrator names a serial number and a
 * location; the backend binds tenant and site and answers a one-time code.
 *
 * The code is shown once. Only its argon2id hash is stored, so a database read
 * does not yield a working credential.
 */

/**
 * Digits only.
 *
 * The code is read off this screen and typed on a vending machine's twelve-key
 * keypad. With letters, each character had to be picked out of a scrolling
 * table - about forty-five key presses for one code. With digits, key 7 types a
 * 7, so eight characters are eight presses. It also ends the confusable
 * problem outright rather than working around it: there is no I/1 or O/0 pair
 * left to avoid.
 */
const ALPHABET = "0123456789";
const CODE_LENGTH = 8;

/**
 * The largest multiple of ALPHABET.length that fits in a byte.
 *
 * Bytes at or above this are thrown away rather than folded in. `byte % 10`
 * would look uniform and is not: 256 is 25*10 + 6, so 0-5 would come up 26
 * times in 256.
 */
const UNBIASED_CEILING = 256 - (256 % ALPHABET.length);

export type ClaimDb = {
  machine: { findUnique(args: unknown): Promise<unknown> };
  site: { findFirst(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
};

type ClaimTx = {
  machine: { updateMany(args: unknown): Promise<{ count: number }> };
  machineActivation: {
    updateMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
};

export type MachineNotFound = { reason: "MACHINE_NOT_FOUND"; message: string };
export type MachineAlreadyClaimed = { reason: "MACHINE_ALREADY_CLAIMED"; message: string };
export type SiteNotFound = { reason: "SITE_NOT_FOUND"; message: string };
export type UnknownClaimError = { reason: "UNKNOWN_ERROR"; message: string };

export type ClaimError = MachineNotFound | MachineAlreadyClaimed | SiteNotFound | UnknownClaimError;

export type ClaimResult = { machineId: string; oneTimeCode: string; expiresAt: Date };

export function generateOneTimeCode(): string {
  const out: string[] = [];

  // Draws a batch, keeps what is in range, and draws again if that was not
  // enough. Each byte is kept with probability 250/256, so a second batch is
  // needed roughly once in ten codes and a third essentially never.
  while (out.length < CODE_LENGTH) {
    const bytes = webcrypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    for (const byte of bytes) {
      if (byte >= UNBIASED_CEILING) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === CODE_LENGTH) break;
    }
  }

  return out.join("");
}

export async function claimMachineService(
  db: ClaimDb,
  input: { tenantId: string; siteId: string; serialNumber: string; userId: string },
  now: Date = new Date(),
): Promise<Result<ClaimError, ClaimResult>> {
  try {
    const machine = (await db.machine.findUnique({
      where: { serialNumber: input.serialNumber },
      select: { id: true, registrationStatus: true, tenantId: true },
    })) as { id: string; registrationStatus: string; tenantId: string | null } | null;

    if (!machine) {
      return err({ reason: "MACHINE_NOT_FOUND", message: "No machine has that serial number." });
    }

    const claimable =
      (machine.registrationStatus === "unregistered" &&
        (machine.tenantId === null || machine.tenantId === input.tenantId)) ||
      (machine.registrationStatus === "claimed" && machine.tenantId === input.tenantId);

    if (!claimable) {
      return err({ reason: "MACHINE_ALREADY_CLAIMED", message: "The machine is already claimed." });
    }

    const site = await db.site.findFirst({
      where: { id: input.siteId, tenantId: input.tenantId },
      select: { id: true },
    });

    if (!site) {
      return err({ reason: "SITE_NOT_FOUND", message: "The site does not belong to this tenant." });
    }

    const oneTimeCode = generateOneTimeCode();
    const codeHash = await hash(oneTimeCode);
    const expiresAt = new Date(now.getTime() + config.ACTIVATION_CODE_TTL_MINUTES * 60_000);

    const claimedWon = await db.$transaction(async (tx) => {
      const t = tx as unknown as ClaimTx;

      const claimed = await t.machine.updateMany({
        where: {
          id: machine.id,
          OR: [
            { registrationStatus: "unregistered", tenantId: null },
            { registrationStatus: "unregistered", tenantId: input.tenantId },
            { registrationStatus: "claimed", tenantId: input.tenantId },
          ],
        },
        data: {
          tenantId: input.tenantId,
          siteId: input.siteId,
          registrationStatus: "claimed",
          claimedAt: now,
        },
      });

      if (claimed.count === 0) return false;

      await t.machineActivation.updateMany({
        where: { machineId: machine.id, usedAt: null },
        data: { expiresAt: now },
      });

      await t.machineActivation.create({
        data: {
          machineId: machine.id,
          tenantId: input.tenantId,
          siteId: input.siteId,
          codeHash,
          expiresAt,
          createdById: input.userId,
        },
      });

      return true;
    });

    if (!claimedWon) {
      return err({ reason: "MACHINE_ALREADY_CLAIMED", message: "The machine is already claimed." });
    }

    return ok({ machineId: machine.id, oneTimeCode, expiresAt });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while claiming the machine.",
    });
  }
}

const MAX_ATTEMPTS = 10;

export type ActivationCodeInvalid = { reason: "ACTIVATION_CODE_INVALID"; message: string };
export type ActivationExpired = { reason: "ACTIVATION_EXPIRED"; message: string };
export type ActivationAttemptsExceeded = { reason: "ACTIVATION_ATTEMPTS_EXCEEDED"; message: string };
export type CsrRejected = { reason: "CSR_REJECTED"; message: string };
export type ActivationCommitFailed = { reason: "ACTIVATION_COMMIT_FAILED"; message: string };
export type MachineDisabled = { reason: "MACHINE_DISABLED"; message: string };

export type ActivateError =
  | ActivationCodeInvalid
  | ActivationExpired
  | ActivationAttemptsExceeded
  | CsrRejected
  | ActivationCommitFailed
  | MachineDisabled
  | UnknownClaimError;

export type ActivationData = {
  certificate: string;
  caCertificate: string;
  machineId: string;
  tenantId: string;
  siteId: string;
  topicPrefix: string;
  mqtt: { host: string; port: number };
};

export type ActivateDb = {
  machineActivation: {
    findFirst(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  machine: { findUnique(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
};

type ActivateTx = {
  machineActivation: { updateMany(args: unknown): Promise<{ count: number }> };
  machine: { update(args: unknown): Promise<unknown> };
  machineCertificate: { create(args: unknown): Promise<unknown> };
};

export async function activateMachineService(
  db: ActivateDb,
  ca: CertificateAuthority,
  input: { machineId: string; code: string; csr: string },
  now: Date = new Date(),
): Promise<Result<ActivateError, ActivationData>> {
  try {
    const machine = (await db.machine.findUnique({
      where: { id: input.machineId },
      select: { id: true, disabledAt: true },
    })) as { id: string; disabledAt: Date | null } | null;

    if (machine?.disabledAt) {
      return err({ reason: "MACHINE_DISABLED", message: "The machine is disabled." });
    }

    const activation = (await db.machineActivation.findFirst({
      where: { machineId: input.machineId },
      orderBy: { createdAt: "desc" },
    })) as {id: string; tenantId: string; siteId: string; codeHash: string; expiresAt: Date; usedAt: Date | null; attempts: number; } | null;

    // A missing, spent or unknown activation reads the same as a wrong code, so
    // the response does not tell an attacker which machine ids are claimable.
    if (!activation || activation.usedAt) {
      return err({ reason: "ACTIVATION_CODE_INVALID", message: "The activation code is not valid." });
    }

    if (activation.attempts >= MAX_ATTEMPTS) {
      return err({
        reason: "ACTIVATION_ATTEMPTS_EXCEEDED",
        message: "Too many attempts. Claim the machine again for a new code.",
      });
    }

    if (activation.expiresAt.getTime() <= now.getTime()) {
      return err({ reason: "ACTIVATION_EXPIRED", message: "The activation code has expired." });
    }

    if (!(await verify(activation.codeHash, input.code))) {
      await db.machineActivation.update({
        where: { id: activation.id },
        data: { attempts: { increment: 1 } },
      });
      return err({ reason: "ACTIVATION_CODE_INVALID", message: "The activation code is not valid." });
    }

    // Signing happens before the transaction below, so a lost race or a failed
    // commit can leave a CA-signed certificate with no MachineCertificate row.
    // That certificate is inert, not a live credential: both verifiers
    // (requireMachine here, and the EMQX authn webhook on the MQTT side)
    // resolve the peer's certificate serial against MachineCertificate with
    // revokedAt: null before trusting anything — a valid chain alone never
    // authenticates a machine. That makes this database lookup load-bearing,
    // not defence-in-depth: a chain-only check on either side would turn an
    // orphaned certificate into a machine takeover. Signing was kept outside
    // the transaction deliberately, to avoid holding a database transaction
    // open across CSR parsing/signing and to keep CSR_REJECTED simple to
    // return.
    let issued: Awaited<ReturnType<typeof signDeviceCsr>>;
    try {
      issued = await signDeviceCsr(ca, input.csr, input.machineId, config.DEVICE_CERT_DAYS);
    } catch (error) {
      return err({
        reason: "CSR_REJECTED",
        message: error instanceof Error ? error.message : "The certificate request was rejected.",
      });
    }

    const committed = await db.$transaction(async (tx) => {
      const t = tx as unknown as ActivateTx;

      const claimed = await t.machineActivation.updateMany({
        where: { id: activation.id, usedAt: null },
        data: { usedAt: now },
      });

      if (claimed.count === 0) return false;

      await t.machineCertificate.create({
        data: {
          machineId: input.machineId,
          serial: issued.serial,
          fingerprint: issued.fingerprint,
          subject: issued.subject,
          notBefore: issued.notBefore,
          notAfter: issued.notAfter,
        },
      });

      await t.machine.update({
        where: { id: input.machineId },
        data: { registrationStatus: "permanent_locked", activatedAt: now },
      });

      return true;
    });

    if (!committed) {
      return err({ reason: "ACTIVATION_COMMIT_FAILED", message: "The activation was already used." });
    }

    return ok({
      certificate: issued.pem,
      caCertificate: ca.certificate.toString("pem"),
      machineId: input.machineId,
      tenantId: activation.tenantId,
      siteId: activation.siteId,
      topicPrefix: buildTopicPrefix({
        id: input.machineId,
        tenantId: activation.tenantId,
        siteId: activation.siteId,
      }),
      mqtt: { host: config.MQTT_PUBLIC_HOST, port: config.MQTT_PUBLIC_PORT },
    });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while activating the machine.",
    });
  }
}
