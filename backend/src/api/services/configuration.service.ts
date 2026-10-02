import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publishCommand } from "@/mqtt/commands";

import * as Sentry from "@sentry/node";
import type { PricePublishOutcome } from "@vmaas/shared/types/configuration";
import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";

import {
  type ConfigurationPayload,
  type StockBlock,
  buildConfigurationPayload,
  buildPrices,
  buildStock,
  comparePayloads,
  findUnwiredSlots,
  toPayloadSlots,
} from "./configuration-payload";

/** How long a machine has to apply a configuration before the command lapses. */
const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;

export type PublishError = {
  reason: "MACHINE_NOT_FOUND" | "NO_SLOTS" | "SLOTS_NOT_WIRED" | "VERSION_NOT_FOUND" | "UNKNOWN_ERROR";
  message: string;
  slots?: number[];
};

/**
 * Thrown inside the `$transaction` callback below, never outside it: throwing
 * mid-transaction is what makes Prisma roll the transaction back, so a rollback
 * request for a version the machine never had writes nothing. Caught by name in
 * the outer `catch`, ahead of the generic UNKNOWN_ERROR fallback.
 */
class VersionNotFoundError extends Error {}

export type PublishConfigurationResult = {
  version: number;
  commandId: string | null;
};

/**
 * Publishes a machine's current slots, prices and wiring as the next
 * configuration version, and tells the machine to come and get it.
 *
 * Publishing is a separate act from saving the layout on purpose: a wrong pin
 * dispenses the wrong product to someone who has already paid, so the wiring
 * gets a review step, and the version history stays one row per deliberate
 * change rather than one per mouse click.
 */
export async function publishConfigurationService(
  machineId: string,
  userId: string,
  fromVersion?: number,
): Promise<Result<PublishError, PublishConfigurationResult>> {
  const [error, result] = await publish(machineId, userId, fromVersion, false);
  if (error) return err(error);
  return ok(result!);
}

export type InitialPublishResult = { published: true; version: number } | { published: false };

/**
 * Publishes version 1 from the saved layout, but only for a machine that has
 * no configuration yet. Called when the machine is activated, so the pins set
 * when it was created in the admin UI reach it the moment it is set up, with
 * no publish press needed. Every later change still goes through
 * publishConfigurationService() and its review step: once any version
 * exists, this does nothing.
 */
export async function publishInitialConfigurationService(machineId: string): Promise<Result<PublishError, InitialPublishResult>> {
  const [error, result] = await publish(machineId, null, undefined, true);
  if (error) return err(error);
  return ok(result ? { published: true, version: result.version } : { published: false });
}

/** Everything the stock block needs, read on the caller's transaction (which must be RepeatableRead). */
async function readStock(tx: Prisma.TransactionClient, machineId: string): Promise<StockBlock> {
  // buildStock sorts by slot number, so no orderBy here.
  const slots = await tx.slot.findMany({ where: { machineId }, select: { id: true, slotNumber: true, quantity: true } });

  // One ack per ledger the machine sold under, most recently used first.
  // Four matches what the machine can track (STOCK_MAX_LEDGERS); an older
  // ledger's sales are long booked. Raw SQL: Prisma cannot group by a JSON path.
  const ackRows = await tx.$queryRaw<{ ledger: string; asOfSequence: bigint | null }[]>`
    SELECT payload->>'ledger' AS ledger, MAX("sequenceNumber") AS "asOfSequence"
    FROM "public"."machine_events"
    WHERE "machineId" = ${machineId}::uuid AND type = 'cash_sale' AND payload->>'ledger' IS NOT NULL
    GROUP BY payload->>'ledger'
    ORDER BY MAX("receivedAt") DESC
    LIMIT 4
  `;
  const acks = ackRows.map((row) => ({ ledger: row.ledger, asOfSequence: Number(row.asOfSequence ?? 0) }));

  // orderBy only so Prisma's groupBy overloads accept the arguments.
  const counts = await tx.inventoryMovement.groupBy({
    by: ["slotId"],
    where: { slotId: { in: slots.map((s) => s.id) }, type: { in: ["restock", "correction"] } },
    _max: { occurredAt: true },
    orderBy: { slotId: "asc" },
  });
  const countedAt = new Map(counts.map((c) => [c.slotId, c._max.occurredAt]));

  return buildStock(
    slots.map((s) => ({ slotNumber: s.slotNumber, quantity: s.quantity, countedAt: countedAt.get(s.id) ?? null })),
    acks,
  );
}

const STOCK_TX = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } as const;

/** @param onlyIfNone Write nothing (and answer null) when any version already exists. */
async function publish(machineId: string, userId: string | null, fromVersion: number | undefined, onlyIfNone: boolean): Promise<Result<PublishError, PublishConfigurationResult | null>> {
  try {
    const machine = await prisma.machine.findFirst({
      where: { id: machineId },
      select: {
        id: true,
        tenantId: true,
        siteId: true,
        stepsPerVend: true,
        slots: {
          orderBy: { slotNumber: "asc" },
          select: {
            slotNumber: true,
            price: true,
            product: { select: { price: true } },
            pins: { select: { number: true } },
          },
        },
      },
    });

    if (!machine) {
      return err({ reason: "MACHINE_NOT_FOUND", message: "No such machine." });
    }

    const slots = toPayloadSlots(machine.slots);

    if (fromVersion === undefined) {
      if (slots.length === 0) {
        return err({ reason: "NO_SLOTS", message: "The machine has no slots to publish." });
      }

      const unwired = findUnwiredSlots(slots);
      if (unwired.length > 0) {
        return err({
          reason: "SLOTS_NOT_WIRED",
          message: `These slots have no motor pins: ${unwired.map((n) => `#${n}`).join(", ")}`,
          slots: unwired,
        });
      }
    }

    const { tenantId, siteId } = machine;
    const commandId = tenantId !== null && siteId !== null ? `cfg-${randomUUID()}` : null;

    const version = await prisma.$transaction(async (tx) => {
      let payload: unknown;

      if (fromVersion === undefined) {
        payload = buildConfigurationPayload(slots, {}, { stepsPerVend: machine.stepsPerVend });
      } else {
        const previous = await tx.machineConfiguration.findFirst({
          where: { machineId, version: fromVersion },
          select: { payload: true },
        });

        if (!previous) {
          throw new VersionNotFoundError(`This machine has no version ${fromVersion}.`);
        }
        payload = previous.payload;
      }

      payload = { ...(payload as object), stock: await readStock(tx, machineId) };

      const latest = await tx.machineConfiguration.findFirst({
        where: { machineId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      if (onlyIfNone && latest) return null;

      const next = (latest?.version ?? 0) + 1;

      await tx.machineConfiguration.create({
        data: { machineId, version: next, payload: payload as Prisma.InputJsonValue, createdById: userId },
      });

      if (tenantId !== null && siteId !== null && commandId) {
        await tx.machineCommand.create({
          data: {
            tenantId,
            machineId,
            commandId,
            type: "apply_configuration",
            payload: { version: next },
            expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
          },
        });
      }

      return next;
    }, STOCK_TX);

    if (version === null) return ok(null);

    if (tenantId !== null && siteId !== null && commandId) {
      await publishCommand({ id: machineId, tenantId, siteId }, { type: "apply_configuration", version }, commandId);
    }

    return ok({ version, commandId });
  } catch (error) {
    if (error instanceof VersionNotFoundError) {
      return err({ reason: "VERSION_NOT_FOUND", message: error.message });
    }

    Sentry.captureException(error, { tags: { service: "configuration", action: "publishing the configuration" } });

    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while publishing the configuration.",
    });
  }
}

export type ConfigurationListResult = {
  versions: { version: number; createdAt: Date; createdBy: { name: string } | null }[];
  drift: { wiring: boolean; prices: boolean } | null;
};

/**
 * The published history of one machine, newest first, for the rollback
 * control, plus whether the machine's current rows have drifted from the
 * newest published version, for the "what's live vs. what's stored" banner.
 */
/**
 * Publishes a machine's current prices and stock as the next version, for the
 * customer's own edits (slot price, product or quantity, product price,
 * confirmed count).
 *
 * Only `prices` and `stock` come from the live slots. Everything else,
 * `wiring` above all, is copied from the last published version, so a
 * customer can change what a slot costs and holds but never which pins it
 * drives: a wiring change still needs publishConfigurationService() and its
 * review step. A machine that was never published has no reviewed wiring to
 * build on and is left alone (its first version comes at activation);
 * unchanged prices and stock write nothing.
 *
 * The outcome says whether the machine will follow now (`sent`, online) or
 * when it next connects (`offline`), so the admin can tell the user.
 */
export async function publishSlotStateService(
  machineId: string,
  userId: string | null,
): Promise<Result<PublishError, PricePublishOutcome>> {
  try {
    const machine = await prisma.machine.findFirst({
      where: { id: machineId },
      select: {
        id: true,
        name: true,
        status: true,
        tenantId: true,
        siteId: true,
        slots: {
          orderBy: { slotNumber: "asc" },
          select: { slotNumber: true, price: true, product: { select: { price: true } }, pins: { select: { number: true } } },
        },
      },
    });

    if (!machine) {
      return err({ reason: "MACHINE_NOT_FOUND", message: "No such machine." });
    }

    const report = (status: PricePublishOutcome["status"], sentId: string | null = null): PricePublishOutcome => ({
      machineId,
      machineName: machine.name,
      status,
      commandId: sentId,
    });

    const prices = buildPrices(toPayloadSlots(machine.slots));
    const { tenantId, siteId } = machine;
    const commandId = tenantId !== null && siteId !== null ? `cfg-${randomUUID()}` : null;

    const outcome = await prisma.$transaction(async (tx) => {
      const latest = await tx.machineConfiguration.findFirst({
        where: { machineId },
        orderBy: { version: "desc" },
        select: { version: true, payload: true },
      });

      if (!latest) return { published: false as const, reason: "NO_PUBLISHED_VERSION" as const };

      const base = (latest.payload ?? {}) as ConfigurationPayload;
      const payload: ConfigurationPayload = { ...base, prices, stock: await readStock(tx, machineId) };
      const changed = comparePayloads(payload, base);
      if (!changed.prices && !changed.stock) return { published: false as const, reason: "UNCHANGED" as const };

      const next = latest.version + 1;
      await tx.machineConfiguration.create({
        data: { machineId, version: next, payload: payload as Prisma.InputJsonValue, createdById: userId },
      });

      if (tenantId !== null && siteId !== null && commandId) {
        await tx.machineCommand.create({
          data: {
            tenantId,
            machineId,
            commandId,
            type: "apply_configuration",
            payload: { version: next },
            expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
          },
        });
      }

      return { published: true as const, version: next };
    }, STOCK_TX);

    if (outcome.published && tenantId !== null && siteId !== null && commandId) {
      await publishCommand(
        { id: machineId, tenantId, siteId },
        { type: "apply_configuration", version: outcome.version },
        commandId,
      );
    }

    if (!outcome.published) return ok(report(outcome.reason === "UNCHANGED" ? "unchanged" : "not_published"));
    return ok(report(machine.status === "online" && commandId ? "sent" : "offline", commandId));
  } catch (error) {
    Sentry.captureException(error, { tags: { service: "configuration", action: "publishing prices and stock" } });

    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while publishing prices and stock.",
    });
  }
}

/**
 * A product's price changed: republish the prices (and stock) of every machine in the
 * tenant where a slot sells that product without a price of its own (a slot
 * with its own price is not affected). One machine failing does not stop the
 * others: a failure is logged and left out of the returned outcomes.
 */
export async function publishSlotStateForProductService(
  tenantId: string,
  productId: string,
  userId: string | null,
): Promise<PricePublishOutcome[]> {
  const machines = await prisma.machine.findMany({
    where: { tenantId, slots: { some: { productId, price: null } } },
    select: { id: true },
  });

  const outcomes: PricePublishOutcome[] = [];
  for (const { id } of machines) {
    const [error, outcome] = await publishSlotStateService(id, userId);
    if (error) console.warn(`configuration: prices for machine ${id} not published: ${error.reason}: ${error.message}`);
    else outcomes.push(outcome);
  }
  return outcomes;
}

export async function listConfigurationsService(
  machineId: string,
): Promise<Result<PublishError, ConfigurationListResult>> {
  try {
    const machine = await prisma.machine.findFirst({
      where: { id: machineId },
      select: {
        id: true,
        stepsPerVend: true,
        slots: {
          select: {
            slotNumber: true,
            price: true,
            product: { select: { price: true } },
            pins: { select: { number: true } },
          },
        },
      },
    });

    if (!machine) {
      return err({ reason: "MACHINE_NOT_FOUND", message: "No such machine." });
    }

    const rows = await prisma.machineConfiguration.findMany({
      where: { machineId },
      orderBy: { version: "desc" },
      select: { version: true, createdAt: true, createdById: true },
    });

    const userIds = [...new Set(rows.flatMap((row) => (row.createdById ? [row.createdById] : [])))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((user) => [user.id, user.name]));

    const latest = await prisma.machineConfiguration.findFirst({
      where: { machineId },
      orderBy: { version: "desc" },
      select: { payload: true },
    });

    // Stock is left out of drift: a quantity edit publishes on its own, so
    // there is never stock waiting for a superadmin to publish.
    const compared = latest
      ? comparePayloads(
          buildConfigurationPayload(toPayloadSlots(machine.slots), {}, { stepsPerVend: machine.stepsPerVend }),
          latest.payload,
        )
      : null;
    const drift = compared ? { wiring: compared.wiring, prices: compared.prices } : null;

    return ok({
      versions: rows.map((row) => ({
        version: row.version,
        createdAt: row.createdAt,
        createdBy: row.createdById ? { name: nameById.get(row.createdById) ?? "Unknown" } : null,
      })),
      drift,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { service: "configuration", action: "listing configurations" } });

    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while listing configurations.",
    });
  }
}
