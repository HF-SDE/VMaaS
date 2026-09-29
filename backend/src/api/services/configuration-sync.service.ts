import * as Sentry from "@sentry/node";
import type { WsServerMessage } from "@vmaas/shared/schemas";
import type { PricePublishOutcome } from "@vmaas/shared/types/configuration";

import { ALERT_SELECT, type AlertWithMachine, toAlertRow } from "./alerts.service";
import { isCommandOpen } from "./device.service";

/**
 * Tells the admin whether a configuration reached the machine.
 *
 * The machine sells at the price it has and books the sale at that price, so a
 * price that did not arrive is money taken at the wrong amount. The user who
 * made the change hears the outcome over the websocket (`configuration.result`);
 * a failure while the machine is online also becomes an alert, which the whole
 * team sees until a later configuration is applied.
 */

/** Every alert this module raises starts with this, which is how it finds them again to resolve. */
export const CONFIGURATION_ALERT_PREFIX = "Configuration update did not reach the machine";

/** How long an online machine has to answer a price change before it is an alert. */
export const PRICE_RESULT_TIMEOUT_MS = 60_000;

export type Broadcast = (tenantId: string, message: WsServerMessage) => void;

export type ConfigurationSyncDb = {
  machine: { findUnique(args: unknown): Promise<unknown> };
  machineCommand: { findFirst(args: unknown): Promise<unknown> };
  securityAlert: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
  };
};

async function raiseAlert(
  db: ConfigurationSyncDb,
  broadcast: Broadcast,
  tenantId: string,
  machineId: string,
  reason: string,
): Promise<void> {
  const alert = (await db.securityAlert.create({
    data: { machineId, type: "error", message: `${CONFIGURATION_ALERT_PREFIX}: ${reason}` },
    select: ALERT_SELECT,
  })) as AlertWithMachine;

  const row = toAlertRow(alert);
  if (row) broadcast(tenantId, { type: "alert.created", body: row });
}

/**
 * Called when a machine posts the result of an `apply_configuration` command.
 * Never throws: the machine's result is already recorded, and what happens here
 * is only notification.
 */
export async function reportConfigurationResultService(
  db: ConfigurationSyncDb,
  broadcast: Broadcast,
  input: {
    tenantId: string | null;
    machineId: string;
    commandId: string;
    status: "completed" | "failed";
    detail: string | null;
  },
): Promise<void> {
  const { tenantId, machineId, commandId, status, detail } = input;
  if (tenantId === null) return;

  try {
    broadcast(tenantId, { type: "configuration.result", body: { commandId, machineId, status, detail } });

    if (status === "failed") {
      await raiseAlert(db, broadcast, tenantId, machineId, detail ?? "the machine reported a failure");
    } else {
      await db.securityAlert.updateMany({
        where: { machineId, type: "error", resolvedAt: null, message: { startsWith: CONFIGURATION_ALERT_PREFIX } },
        data: { resolvedAt: new Date() },
      });
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { service: "configuration-sync", action: "reporting a result" } });
    console.error("[configuration-sync] reporting a configuration result failed", error);
  }
}

/**
 * After a price change was sent to an online machine: if it has not answered
 * within @p timeoutMs and is still online, raise an alert. A machine that went
 * offline meanwhile is left alone, since it fetches the latest configuration
 * when it reconnects.
 *
 * In-process timer: a backend restart inside the window drops the check. The
 * command itself is unaffected and the machine still answers it.
 */
export function watchPriceCommand(db: ConfigurationSyncDb, broadcast: Broadcast, input: { tenantId: string; machineId: string; commandId: string }, timeoutMs: number = PRICE_RESULT_TIMEOUT_MS): void {
  const timer = setTimeout(async () => {
    try {
      const command = (await db.machineCommand.findFirst({
        where: { commandId: input.commandId, machineId: input.machineId },
        select: { status: true },
      })) as { status: string } | null;
      if (!command || !isCommandOpen(command.status)) return;

      const machine = (await db.machine.findUnique({
        where: { id: input.machineId },
        select: { status: true },
      })) as { status: string } | null;
      if (machine?.status !== "online") return;

      await raiseAlert(
        db,
        broadcast,
        input.tenantId,
        input.machineId,
        `no answer from the machine within ${Math.round(timeoutMs / 1000)} s`,
      );
    } catch (error) {
      Sentry.captureException(error, { tags: { service: "configuration-sync", action: "watching a price command" } });
      console.error("[configuration-sync] watching a price command failed", error);
    }
  }, timeoutMs);

  timer.unref?.();
}

/** watchPriceCommand() for every outcome that was sent to an online machine. */
export function watchSentPriceCommands(db: ConfigurationSyncDb, broadcast: Broadcast, tenantId: string, outcomes: PricePublishOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.status === "sent" && outcome.commandId) {
      watchPriceCommand(db, broadcast, { tenantId, machineId: outcome.machineId, commandId: outcome.commandId });
    }
  }
}
