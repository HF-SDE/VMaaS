import * as Sentry from "@sentry/node";
import { type Result, err, ok } from "@vmaas/shared/lib";
import { DeviceEvent, cashSalePayloadSchema } from "@vmaas/shared/schemas";

import type { MachineContext } from "@/api/middleware/require-machine";
import { Prisma } from "@/generated/prisma/client";
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
export type CashSalePayloadInvalid = { reason: "CASH_SALE_PAYLOAD_INVALID"; message: string };

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
  sale: { create(args: unknown): Promise<unknown> };
  inventoryMovement: { create(args: unknown): Promise<unknown> };
  slot: {
    findFirst(args: unknown): Promise<unknown>;
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
    Sentry.captureException(error, { tags: { service: "device", action: "reading the configuration" } });

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
    Sentry.captureException(error, { tags: { service: "device", action: "recording the result" } });

    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while recording the result.",
    });
  }
}

/** The unique index behind MachineEvent.eventId (migration 20260917185806_machine_activation). */
const EVENT_ID_UNIQUE_INDEX = "machine_events_eventId_key";

/**
 * True when @p cause is a unique violation on MachineEvent.eventId.
 *
 * Prisma 7 through @prisma/adapter-pg reports P2002 without `meta.target`:
 * the constraint is under `meta.driverAdapterError.cause.constraint`, as
 * `{ index }` when Postgres names the constraint (it always does) or
 * `{ fields }` otherwise. `meta.target` is still accepted for any other
 * engine. Matching the index or field rather than P2002 alone keeps a future
 * unique index on this table from being mistaken for "already booked".
 */
function isEventIdUniqueViolation(cause: unknown): boolean {
  const e = cause as {
    code?: string;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { index?: string; fields?: string[] } } };
    };
  };
  if (e?.code !== "P2002") return false;

  const target = e.meta?.target;
  if (Array.isArray(target) ? target.includes("eventId") : target === "eventId") return true;

  const constraint = e.meta?.driverAdapterError?.cause?.constraint;
  return constraint?.index === EVENT_ID_UNIQUE_INDEX || (constraint?.fields?.includes("eventId") ?? false);
}

export async function recordDeviceEventService(
  db: DeviceDb,
  machine: MachineContext,
  input: {
    type: string;
    payload: Record<string, unknown>;
    eventId?: string;
    sequenceNumber?: number;
    occurredAt?: string;
    uptimeMs?: number;
  },
): Promise<
  Result<
    UnknownDeviceError | CashSalePayloadInvalid,
    { stored: boolean } | { saleId: string; duplicate: false } | { duplicate: true }
  >
> {
  const occurredAt =
    input.occurredAt !== undefined ? new Date(input.occurredAt) : new Date(Date.now() - (input.uptimeMs ?? 0));
  if (input.type === "cash_sale") {
    const parsed = cashSalePayloadSchema.safeParse(input.payload);
    if (!parsed.success) {
      return err({
        reason: "CASH_SALE_PAYLOAD_INVALID",
        message: `cash_sale payload rejected: ${parsed.error.message}`,
      });
    }

    const cash = parsed.data;
    const priceMajor = new Prisma.Decimal(cash.price_minor).div(100);

    try {
      return ok(
        await db.$transaction(async (tx) => {
          try {
            await tx.machineEvent.create({
              data: {
                machineId: machine.id,
                tenantId: machine.tenantId,
                type: input.type,
                payload: input.payload,
                eventId: input.eventId,
                sequenceNumber: input.sequenceNumber,
                occurredAt,
              },
            });
          } catch (cause) {
            if (isEventIdUniqueViolation(cause)) {
              return { duplicate: true as const };
            }
            throw cause;
          }

          const slot = (await tx.slot.findFirst({
            where: { machineId: machine.id, slotNumber: cash.slot },
            select: { id: true, productId: true },
          })) as { id: string; productId: string | null } | null;

          const sale = (await tx.sale.create({
            data: {
              tenantId: machine.tenantId,
              machineId: machine.id,
              productId: slot?.productId ?? null,
              status: cash.status,
              price: priceMajor,
              completedAt: cash.status === "completed" ? occurredAt : null,
            },
          })) as { id: string };

          if (cash.status === "completed" && slot) {
            // A sale from before the slot's last count (restock, correction,
            // confirmed count) is already reflected in the counted number:
            // booked as a sale, not taken off the stock again. Strictly
            // after, the same rule the machine applies (spec: slot stock).
            const lastCount = (await tx.inventoryMovement.findFirst({
              where: { slotId: slot.id, type: { in: ["restock", "correction"] } },
              orderBy: { occurredAt: "desc" },
              select: { occurredAt: true },
            })) as { occurredAt: Date } | null;

            // A sale without a real timestamp (the device had no clock and
            // sent uptimeMs) has only an estimated time; the machine always
            // subtracts such a sale, so it always decrements here too.
            const hasRealTime = input.occurredAt !== undefined;
            if (!hasRealTime || !lastCount || occurredAt.getTime() > lastCount.occurredAt.getTime()) {
              // Never below 0: a count set lower while the machine sold
              // offline must not leave the slot negative.
              await tx.slot.updateMany({
                where: { id: slot.id, quantity: { gt: 0 } },
                data: { quantity: { decrement: 1 } },
              });
            }
          }

          await tx.inventoryMovement.create({
            data: {
              tenantId: machine.tenantId,
              slotId: slot?.id ?? null,
              type: cash.status === "completed" ? "sale" : "dispense_failure",
              quantity: cash.status === "completed" ? -1 : 0,
              saleId: sale.id,
              note: cash.reason ?? null,
              occurredAt,
            },
          });

          return { saleId: sale.id, duplicate: false as const };
        }),
      );
    } catch (cause) {
      Sentry.captureException(cause, { tags: { service: "device", action: "recording the cash sale" } });
      console.error("[device.service] recording the cash sale failed", cause);
      return err({
        reason: "UNKNOWN_ERROR",
        message: cause instanceof Error ? cause.message : "Unknown error while recording the cash sale.",
      });
    }
  }

  try {
    await db.machineEvent.create({
      data: {
        machineId: machine.id,
        tenantId: machine.tenantId,
        type: input.type,
        payload: input.payload,
        eventId: input.eventId ? `${machine.id}:${input.eventId}` : undefined,
        sequenceNumber: input.sequenceNumber,
        occurredAt,
      },
    });

    return ok({ stored: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      return ok({ stored: false });
    }

    Sentry.captureException(error, { tags: { service: "device", action: "storing the event" } });

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
  events: DeviceEvent[],
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
        occurredAt: new Date(event.occurredAt ?? Date.now() - (event.uptimeMs ?? 0)),
      })),
      skipDuplicates: true,
    });

    return ok({ received: events.length, stored: count });
  } catch (error) {
    Sentry.captureException(error, { tags: { service: "device", action: "storing the events" } });

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
    Sentry.captureException(error, { tags: { service: "device", action: "rotating the certificate" } });

    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while rotating the certificate.",
    });
  }

  return ok({ certificate: issued.pem, caCertificate: ca.certificate.toString("pem") });
}
