import { type Result, err, ok } from "@vmaas/shared/lib";

import type { MachineContext } from "@/api/middleware/require-machine";
import { config } from "@/lib/config";
import { type CertificateAuthority, signDeviceCsr } from "@/lib/pki";

/**
 * Everything a machine may do over HTTP. The machine is `req.machine`, resolved
 * from its client certificate, and every query is scoped by it. No request here
 * carries an identifier a device could point somewhere else.
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
  machineEvent: {
    create(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
  machineCertificate: {
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
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
 * Shared with the MQTT path. Two copies of this rule would eventually drift,
 * and a replayed result would then apply on one transport but not the other.
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
    const command = (await db.machineCommand.findFirst({
      where: { commandId: input.commandId, machineId: machine.id },
      select: { id: true, status: true },
    })) as { id: string; status: string } | null;

    if (!command) {
      return err({ reason: "COMMAND_NOT_FOUND", message: "The command does not exist for this machine." });
    }

    if (!isCommandOpen(command.status)) {
      return ok({ applied: false });
    }

    const completedAt = input.completedAt ? new Date(input.completedAt) : now;

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
        eventId: input.eventId ? `${machine.id}:${input.eventId}` : undefined,
        sequenceNumber: input.sequenceNumber,
        occurredAt: new Date(input.occurredAt),
      },
    });

    return ok({ stored: true });
  } catch (error) {
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
 * Stores a batch a machine sent while draining its offline journal.
 *
 * One `createMany`, so the batch is atomic: it is stored wholly or not at all,
 * and the device's cursor never has to reason about a partial write.
 * `skipDuplicates` is what makes a replay free - a device that never saw our
 * response re-sends the same `eventId`s and gets a 201 with a lower `stored`.
 */
export async function recordDeviceEventsService(
  db: DeviceDb,
  machine: MachineContext,
  events: {
    type: string;
    payload: Record<string, unknown>;
    eventId?: string;
    sequenceNumber?: number;
    occurredAt: string;
  }[],
): Promise<Result<UnknownDeviceError, { received: number; stored: number }>> {
  try {
    const { count } = await db.machineEvent.createMany({
      data: events.map((event) => ({
        machineId: machine.id,
        tenantId: machine.tenantId,
        type: event.type,
        payload: event.payload,
        eventId: event.eventId ? `${machine.id}:${event.eventId}` : undefined,
        sequenceNumber: event.sequenceNumber,
        occurredAt: new Date(event.occurredAt),
      })),
      skipDuplicates: true,
    });

    return ok({ received: events.length, stored: count });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while storing the events.",
    });
  }
}

/** Rotate the device's certificate, replacing it with a new one signed by the CA.
 *  The old certificate is revoked. */
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
