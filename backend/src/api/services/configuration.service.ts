import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { publishCommand } from "@/mqtt/commands";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";

import { buildConfigurationPayload, comparePayloads, findUnwiredSlots, toPayloadSlots } from "./configuration-payload";

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
  try {
    const machine = (await prisma.machine.findFirst({
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
    })) as {
      id: string;
      tenantId: string | null;
      siteId: string | null;
      stepsPerVend: number;
      slots: { slotNumber: number; price: unknown; product: { price: unknown } | null; pins: { number: number }[] }[];
    } | null;

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
        const previous = (await tx.machineConfiguration.findFirst({
          where: { machineId, version: fromVersion },
          select: { payload: true },
        })) as { payload: unknown } | null;

        if (!previous) {
          throw new VersionNotFoundError(`This machine has no version ${fromVersion}.`);
        }
        payload = previous.payload;
      }

      const latest = (await tx.machineConfiguration.findFirst({
        where: { machineId },
        orderBy: { version: "desc" },
        select: { version: true },
      })) as { version: number } | null;

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
    });

    if (tenantId !== null && siteId !== null && commandId) {
      await publishCommand({ id: machineId, tenantId, siteId }, { type: "apply_configuration", version }, commandId);
    }

    return ok({ version, commandId });
  } catch (error) {
    if (error instanceof VersionNotFoundError) {
      return err({ reason: "VERSION_NOT_FOUND", message: error.message });
    }

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
export async function listConfigurationsService(
  machineId: string,
): Promise<Result<PublishError, ConfigurationListResult>> {
  try {
    const machine = (await prisma.machine.findFirst({
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
    })) as {
      id: string;
      stepsPerVend: number;
      slots: { slotNumber: number; price: unknown; product: { price: unknown } | null; pins: { number: number }[] }[];
    } | null;

    if (!machine) {
      return err({ reason: "MACHINE_NOT_FOUND", message: "No such machine." });
    }

    const rows = (await prisma.machineConfiguration.findMany({
      where: { machineId },
      orderBy: { version: "desc" },
      select: { version: true, createdAt: true, createdById: true },
    })) as { version: number; createdAt: Date; createdById: string | null }[];

    const userIds = [...new Set(rows.flatMap((row) => (row.createdById ? [row.createdById] : [])))];
    const users = (await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    })) as { id: string; name: string }[];
    const nameById = new Map(users.map((user) => [user.id, user.name]));

    const latest = (await prisma.machineConfiguration.findFirst({
      where: { machineId },
      orderBy: { version: "desc" },
      select: { payload: true },
    })) as { payload: unknown } | null;

    const drift = latest
      ? comparePayloads(
          buildConfigurationPayload(toPayloadSlots(machine.slots), {}, { stepsPerVend: machine.stepsPerVend }),
          latest.payload,
        )
      : null;

    return ok({
      versions: rows.map((row) => ({
        version: row.version,
        createdAt: row.createdAt,
        createdBy: row.createdById ? { name: nameById.get(row.createdById) ?? "Unknown" } : null,
      })),
      drift,
    });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while listing configurations.",
    });
  }
}
