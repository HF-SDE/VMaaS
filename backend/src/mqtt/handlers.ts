import { isCommandOpen } from "@/api/services/device.service";

import type { ParsedTopic } from "./topics";

/**
 * Machine-to-platform messages only: a machine reporting the outcome of a
 * command. Configuration now goes over HTTP (`GET /api/device/configuration`,
 * mTLS), so nothing device-initiated arrives on MQTT any more.
 *
 * Every handler re-derives tenant, site and machine from the topic and checks
 * them against a machine row. Identifiers in the payload grant nothing, and a
 * message whose topic does not resolve is dropped.
 *
 * The outcome lives in the command row and the event; no machine status column
 * is written here.
 */

export type HandlerDb = {
  machine: { findFirst(args: unknown): Promise<unknown> };
  machineCommand: {
    findFirst(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  machineEvent: { create(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
};

type HandlerTx = {
  machineCommand: { update(args: unknown): Promise<unknown> };
  machineEvent: { create(args: unknown): Promise<unknown> };
};

/** Confirms the topic's three identifiers describe a real, enabled machine. */
async function resolveMachine(db: HandlerDb, topic: ParsedTopic) {
  return (await db.machine.findFirst({
    where: {
      id: topic.machineId,
      tenantId: topic.tenantId,
      siteId: topic.siteId,
      disabledAt: null,
    },
    select: { id: true, tenantId: true, siteId: true },
  })) as { id: string; tenantId: string; siteId: string } | null;
}

export async function handleCommandResult(
  db: HandlerDb,
  topic: ParsedTopic,
  payload: { status?: string; detail?: string; completedAt?: string },
): Promise<void> {
  const commandId = topic.rest[0];
  if (!commandId) return;

  const machine = await resolveMachine(db, topic);
  if (!machine) return;

  const command = (await db.machineCommand.findFirst({
    where: { commandId, machineId: machine.id },
    select: { id: true, status: true },
  })) as { id: string; status: string } | null;

  if (!command) return;
  if (!isCommandOpen(command.status)) return;

  const failed = payload.status !== "completed";
  const completedAt = payload.completedAt ? new Date(payload.completedAt) : new Date();

  await db.$transaction(async (tx) => {
    const t = tx as unknown as HandlerTx;

    await t.machineCommand.update({
      where: { id: command.id },
      data: {
        status: failed ? "failed" : "completed",
        completedAt,
        result: payload.detail ? { detail: payload.detail } : {},
      },
    });

    await t.machineEvent.create({
      data: {
        machineId: machine.id,
        tenantId: machine.tenantId,
        type: failed ? "setup-failed" : "setup-confirmed",
        payload: { ...payload, commandId },
        occurredAt: completedAt,
      },
    });
  });
}
