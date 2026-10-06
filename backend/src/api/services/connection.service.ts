import { createAlertService } from "@/api/services/alerts.service";
import { broadcast } from "@/lib/ws/registry";
import { redeliverOpenCommands } from "@/mqtt/commands";

import { type Result, err, ok } from "@vmaas/shared/lib";

/**
 * Broker-driven online/offline detection.
 *
 * EMQX's own `$events/client_connected` and `$events/client_disconnected`
 * feed this via a declarative rule + HTTP action in config/emqx/emqx.conf —
 * no MQTT topic, no device cooperation required, and the broker fires it
 * whether or not the device behaves. The reported clientid IS the machine id
 * (`peer_cert_as_clientid = cn`, enforced by the authn webhook refusing any
 * mismatch), so it is trusted here exactly as a certificate serial is trusted
 * on the other internal routes. Nothing else in the request body is trusted:
 * no machine id, tenant id or site id is ever read from it.
 */

/** Only pki-init issues a certificate with this CN; a device can never present it. */
export const PLATFORM_CLIENT_ID = "vmaas-platform";

export const CONNECTION_EVENT_TYPES = {
  online: "machine-online",
  offline: "machine-offline",
} as const;

export type ConnectionStatus = "online" | "offline";

export type ConnectionDb = {
  machine: {
    findUnique(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  machineEvent: {
    create(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
};

type ConnectionTx = {
  machine: { updateMany(args: unknown): Promise<{ count: number }> };
  machineEvent: { create(args: unknown): Promise<unknown> };
};

export type UnknownConnectionError = { reason: "UNKNOWN_ERROR"; message: string };

export type RecordConnectionInput = {
  clientId: string;
  status: ConnectionStatus;
  /** The broker's own `connected_at` / `disconnected_at`, never the rule's firing time. */
  occurredAt: Date;
  /** Broker-generated disconnect reason; never present (and never trusted) for a connect. */
  reason?: string;
};

type MachineIdentity = { id: string; tenantId: string | null };

/**
 * `Machine.lastConnectionEventAt` is the ordering clock: an event whose
 * `occurredAt` is not strictly after it is stale (e.g. a late disconnect
 * from before a reconnect) and is dropped, so it cannot mark a live machine
 * offline.
 *
 * The clock advances on every accepted event, including a no-op with the
 * same status; otherwise an older in-flight event could still look newer
 * and be applied.
 *
 * The check and the write are one conditional `updateMany` (same pattern as
 * `claimedWon` in activation.service.ts), so overlapping requests or EMQX
 * retries cannot both win. Two updates cover the outcomes:
 *   - `status <> input.status`: flips `status`; a `MachineEvent` is written
 *     only if `count` is 1.
 *   - `status = input.status`: advances only the clock.
 *
 * An equal timestamp counts as stale, which keeps retries idempotent. A
 * disconnect and reconnect within the same millisecond therefore drops the
 * second; accepted, as EMQX's clock is coarser than that.
 */
export async function recordConnectionEventService(
  db: ConnectionDb,
  input: RecordConnectionInput,
): Promise<Result<UnknownConnectionError, { applied: boolean }>> {
  try {
    if (input.clientId === PLATFORM_CLIENT_ID) {
      return ok({ applied: false });
    }

    let machine: MachineIdentity | null;
    try {
      machine = (await db.machine.findUnique({
        where: { id: input.clientId },
        select: { id: true, tenantId: true },
      })) as MachineIdentity | null;
    } catch {
      machine = null;
    }

    if (!machine) {
      return ok({ applied: false });
    }

    const notStale = {
      OR: [{ lastConnectionEventAt: null }, { lastConnectionEventAt: { lt: input.occurredAt } }],
    };

    const transitioned = await db.$transaction(async (tx) => {
      const t = tx as unknown as ConnectionTx;

      const changed = await t.machine.updateMany({
        where: { id: machine!.id, status: { not: input.status }, ...notStale },
        data: { status: input.status, lastConnectionEventAt: input.occurredAt },
      });

      if (changed.count === 0) return false;

      await t.machineEvent.create({
        data: {
          machineId: machine!.id,
          tenantId: machine!.tenantId,
          type: CONNECTION_EVENT_TYPES[input.status],
          payload: input.status === "offline" ? { reason: input.reason ?? null } : {},
          occurredAt: input.occurredAt,
        },
      });

      return true;
    });

    if (transitioned) {
      if (input.status === "online") void redeliverOpenCommands(machine.id);

      if (input.status === "offline" && machine.tenantId) {
        const [alertError, row] = await createAlertService({
          machineId: machine.id,
          type: "offline",
          message: input.reason ? `Machine went offline (${input.reason})` : "Machine went offline",
          occurredAt: input.occurredAt,
        });
        if (alertError) return err(alertError);

        if (row) broadcast(machine.tenantId, { type: "alert.created", body: row });
      }

      return ok({ applied: true });
    }

    await db.machine.updateMany({
      where: { id: machine.id, status: input.status, ...notStale },
      data: { lastConnectionEventAt: input.occurredAt },
    });

    return ok({ applied: false });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while recording the connection event.",
    });
  }
}
