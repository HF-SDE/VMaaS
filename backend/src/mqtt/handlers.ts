import { isCommandOpen } from "@/api/services/device.service";

import type { ParsedTopic } from "./topics";

/**
 * Phase 3 of docs/image.png.
 *
 * Configuration delivery happens over HTTP now (`GET
 * /api/device/configuration`, mTLS-authenticated) — nothing device-initiated
 * happens on MQTT any more. This module is left with the machine-to-platform
 * half only: a machine reports the outcome of a command it was sent.
 *
 * Every handler re-derives tenant, site and machine from the topic and
 * confirms they match a machine row. A payload's own identifiers grant
 * nothing; a message whose topic does not resolve is dropped.
 *
 * `isCommandOpen` is imported from device.service.ts rather than re-expressed
 * here: it is the one rule for "is this command still open", shared with the
 * HTTP device path so the two transports cannot disagree about whether a
 * result lands on a command that has already been settled.
 *
 * No machine status column is written anywhere here. The outcome lives in the
 * command row and the event, which is the whole record of what happened.
 */

export type HandlerDb = {
  machine: { findFirst(args: unknown): Promise<unknown> };
  machineCommand: {
    findFirst(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  machineEvent: { create(args: unknown): Promise<unknown> };
  // See the matching note on `ClaimDb.$transaction` in activation.service.ts:
  // `tx: any` keeps the real PrismaClient's overloaded `$transaction`
  // structurally assignable here with no cast at the call site.
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
  // Replays are expected from the offline queue; applying one twice is not.
  if (!isCommandOpen(command.status)) return;

  const failed = payload.status !== "completed";
  const completedAt = payload.completedAt ? new Date(payload.completedAt) : new Date();

  // Settling the command and recording the event must be one atomic write, the
  // same as the HTTP device path (device.service.ts). If the event write failed
  // after the command update committed, the command would be closed forever
  // while no event recorded it: isCommandOpen would then short-circuit every
  // replay and the event would be lost, leaving the two transports with
  // divergent history for the same outcome.
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
