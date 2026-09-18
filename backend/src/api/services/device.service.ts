import { type Result, err, ok } from "@vmaas/shared/lib";

import type { MachineContext } from "@/api/middleware/require-machine";
import { config } from "@/lib/config";
import { type CertificateAuthority, signDeviceCsr } from "@/lib/pki";

/**
 * Everything a machine may do over HTTP. The machine is `req.machine`, resolved
 * from its client certificate, and every query is scoped by it — there is no
 * identifier in any request for a device to point somewhere else (spec §8).
 */

export type ConfigurationNotFound = { reason: "CONFIGURATION_NOT_FOUND"; message: string };
export type CommandNotFound = { reason: "COMMAND_NOT_FOUND"; message: string };
export type CsrRejected = { reason: "CSR_REJECTED"; message: string };
export type UnknownDeviceError = { reason: "UNKNOWN_ERROR"; message: string };

export type DeviceDb = {
  machineConfiguration: { findFirst(args: unknown): Promise<unknown> };
  machineCommand: {
    findFirst(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  machineEvent: { create(args: unknown): Promise<unknown> };
  machineCertificate: {
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  // `tx: any` (not `never`) so the real PrismaClient's overloaded
  // `$transaction` — an array-of-promises form and this callback form — is
  // structurally assignable here with no cast at the call site. See the
  // matching note on `ClaimDb.$transaction` in activation.service.ts.
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
};

type CommandResultTx = {
  machineCommand: { update(args: unknown): Promise<unknown> };
  machineEvent: { create(args: unknown): Promise<unknown> };
};

type CertificateRotationTx = {
  machineCertificate: {
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

/**
 * The one rule for "is this command still open", shared with the MQTT path so
 * the two transports cannot disagree about whether a result lands on a command
 * that has already been settled. Two divergent copies of this predicate is
 * exactly the kind of drift that lets a replayed result apply twice on one
 * transport and not the other.
 */
export function isCommandOpen(status: string): boolean {
  return status === "pending" || status === "sent";
}

export async function getDeviceConfigurationService(
  db: DeviceDb,
  machine: MachineContext,
): Promise<Result<ConfigurationNotFound | UnknownDeviceError, { version: number; payload: unknown }>> {
  try {
    const configuration = (await db.machineConfiguration.findFirst({
      where: { machineId: machine.id },
      orderBy: { version: "desc" },
      select: { version: true, payload: true },
    })) as { version: number; payload: unknown } | null;

    if (!configuration) {
      return err({
        reason: "CONFIGURATION_NOT_FOUND",
        message: "No configuration has been published for this machine.",
      });
    }

    return ok(configuration);
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while reading the configuration.",
    });
  }
}

export async function recordCommandResultService(
  db: DeviceDb,
  machine: MachineContext,
  input: { commandId: string; status: "completed" | "failed"; detail?: string; completedAt?: string },
  now: Date = new Date(),
): Promise<Result<CommandNotFound | UnknownDeviceError, { applied: boolean }>> {
  try {
    // Compound filter, never a bare id: another machine's command must read as
    // absent rather than as forbidden.
    const command = (await db.machineCommand.findFirst({
      where: { commandId: input.commandId, machineId: machine.id },
      select: { id: true, status: true },
    })) as { id: string; status: string } | null;

    if (!command) {
      return err({ reason: "COMMAND_NOT_FOUND", message: "The command does not exist for this machine." });
    }

    // A replayed result is not an error — the offline queue is allowed to send
    // the same thing twice (§10, §13). It is simply not applied again, and no
    // second MachineEvent is written for it.
    if (!isCommandOpen(command.status)) {
      return ok({ applied: false });
    }

    const completedAt = input.completedAt ? new Date(input.completedAt) : now;

    // Closing the command and writing its history event must commit together.
    // Without a transaction, a crash or a failed event write after the update
    // has already landed would leave the command CLOSED with no event — and
    // because a closed command short-circuits at `isCommandOpen` above, a
    // retried result could never recreate that missing event (§10, §13). A
    // transaction makes the failure recoverable instead of permanent: if the
    // event write fails, the update rolls back with it, the command is still
    // open, and the next replay from the offline queue can complete both.
    await db.$transaction(async (tx) => {
      const t = tx as unknown as CommandResultTx;

      await t.machineCommand.update({
        where: { id: command.id },
        data: {
          status: input.status,
          completedAt,
          result: input.detail ? { detail: input.detail } : {},
        },
      });

      // The MQTT handler writes the same event for its version of this
      // outcome, using the same type names, so history reads the same
      // regardless of which transport a device happened to use. Stamped from
      // the verified credential (`machine`), never from the request body,
      // which carries no machine/tenant/site id at all (spec §8).
      await t.machineEvent.create({
        data: {
          machineId: machine.id,
          tenantId: machine.tenantId,
          type: input.status === "completed" ? "setup-confirmed" : "setup-failed",
          payload: { commandId: input.commandId, detail: input.detail ?? null },
          occurredAt: completedAt,
        },
      });
    });

    return ok({ applied: true });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while recording the result.",
    });
  }
}

export async function recordDeviceEventService(
  db: DeviceDb,
  machine: MachineContext,
  input: {
    type: string;
    payload: Record<string, unknown>;
    eventId?: string;
    sequenceNumber?: number;
    occurredAt: string;
  },
): Promise<Result<UnknownDeviceError, { stored: boolean }>> {
  try {
    await db.machineEvent.create({
      data: {
        machineId: machine.id,
        tenantId: machine.tenantId,
        type: input.type,
        payload: input.payload,
        eventId: input.eventId,
        sequenceNumber: input.sequenceNumber,
        occurredAt: new Date(input.occurredAt),
      },
    });

    return ok({ stored: true });
  } catch (error) {
    // P2002 is Prisma's unique violation: this eventId is already stored, which
    // is exactly what the id is for.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      return ok({ stored: false });
    }

    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while storing the event.",
    });
  }
}

/**
 * Rotation. The current certificate authorises its successor, which is what
 * lets DEVICE_CERT_DAYS stay short without bricking machines. The new row is
 * written before the old one is revoked, KEEPING that order inside a single
 * transaction: if the revoke fails, the transaction rolls the create back
 * with it, so there is never a moment where a crash or a partial failure
 * leaves two live certificates for one machine. That matters beyond today —
 * `requireMachine` currently resolves by certificate SERIAL rather than "the
 * one live certificate for this machine", so a transient two-live-certificate
 * state happens to authenticate correctly right now, but a later disable path
 * that revokes a machine's certificates would find two rows to revoke where
 * it expects one. `machine.certificateId` comes from the verified credential
 * (`requireMachine`), never from the request, so there is nothing here for a
 * device to redirect.
 */
export async function renewCertificateService(
  db: DeviceDb,
  ca: CertificateAuthority,
  machine: MachineContext,
  csr: string,
  now: Date = new Date(),
): Promise<Result<CsrRejected | UnknownDeviceError, { certificate: string; caCertificate: string }>> {
  let issued: Awaited<ReturnType<typeof signDeviceCsr>>;
  try {
    issued = await signDeviceCsr(ca, csr, machine.id, config.DEVICE_CERT_DAYS);
  } catch (error) {
    return err({
      reason: "CSR_REJECTED",
      message: error instanceof Error ? error.message : "The certificate request was rejected.",
    });
  }

  try {
    await db.$transaction(async (tx) => {
      const t = tx as unknown as CertificateRotationTx;

      await t.machineCertificate.create({
        data: {
          machineId: machine.id,
          serial: issued.serial,
          fingerprint: issued.fingerprint,
          subject: issued.subject,
          notBefore: issued.notBefore,
          notAfter: issued.notAfter,
        },
      });

      await t.machineCertificate.update({
        where: { id: machine.certificateId },
        data: { revokedAt: now, revokedReason: "rotated" },
      });
    });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while rotating the certificate.",
    });
  }

  return ok({ certificate: issued.pem, caCertificate: ca.certificate.toString("pem") });
}
