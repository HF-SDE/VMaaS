import { type Result, err, ok } from "@vmaas/shared/lib";

/**
 * Broker-driven online/offline detection. See the "Connection events" section
 * of docs/superpowers/specs/2026-09-17-machine-activation-design.md for why
 * this replaced the MQTT Last Will that `status/connection` used to carry.
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
  // `tx: any` (not `never`) so the real PrismaClient's overloaded
  // `$transaction` is structurally assignable here with no cast at the call
  // site — same trick as ClaimDb / DeviceDb.
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
 * `Machine.lastConnectionEventAt` is the ordering clock for this feed: an
 * incoming event whose `occurredAt` is not strictly after the machine's
 * recorded clock is stale — most often a disconnect for a session the
 * machine has since reconnected past, arriving late because of TCP
 * reordering, a retry, or a kick immediately followed by a reconnect — and
 * must be dropped rather than applied, so it cannot mark a live machine dead.
 *
 * The clock advances on EVERY accepted (non-stale) event, including a
 * no-op one where the reported status already matches the current status.
 * That is deliberate, not incidental: if a same-status event did NOT move
 * the clock, an older event still in flight behind it (e.g. a genuine
 * disconnect from before a reconnect that raced ahead of it) would still
 * read as "newer than the clock" and get applied on top of a machine that
 * has since reconnected — reopening exactly the window this exists to
 * close. Advancing the clock on every accepted event, including the no-op,
 * is what makes a reordered older event correctly stale once a newer one —
 * of ANY status — has already landed.
 *
 * Both the ordering check and the write are done as ONE conditional
 * `updateMany`, in the same shape as the claim race in activation.service.ts
 * (`claimedWon`): the guard (`lastConnectionEventAt` is null or strictly
 * before the incoming event) is part of the `WHERE`, not a separate read
 * beforehand, so two overlapping requests for the same machine — a
 * connect/disconnect pair seconds apart, or EMQX's async buffer-worker
 * retrying a delivery that already landed — cannot both read the same prior
 * state and both "win". Postgres serializes concurrent `UPDATE`s to the same
 * row and re-evaluates each one's `WHERE` against the just-committed row, so
 * the loser's guard genuinely fails rather than racing on stale data.
 *
 * Two separate conditional updates cover the two outcomes:
 *   - `status <> input.status` (a genuine transition): also flips `status`.
 *     A `MachineEvent` is written if and only if this one's `count` is 1.
 *   - `status = input.status` (a no-op): advances only the clock.
 * Exactly one of the two can ever match for a given row, so there is no
 * double-write.
 *
 * Staleness uses `<`, not `<=`: an event whose timestamp exactly equals the
 * clock is treated as stale and dropped. This keeps a replayed/retried
 * event idempotent (the same event landing twice is a no-op the second
 * time), but it has a residual: a genuine disconnect immediately followed
 * by a genuine reconnect in the same millisecond will apply only the first
 * of the two and drop the second. Accepted as out of scope — EMQX's own
 * clock resolution is coarser than that in practice, and the failure mode
 * (a live machine transiently shown as stale-offline until its next event)
 * is the same class of harm this whole mechanism otherwise closes, not a
 * new one.
 */
export async function recordConnectionEventService(
  db: ConnectionDb,
  input: RecordConnectionInput,
): Promise<Result<UnknownConnectionError, { applied: boolean }>> {
  try {
    // The backend's own MQTT client. It connects and disconnects like any
    // other client — most visibly on every `docker compose restart backend`
    // — and none of that is a machine going online or offline.
    if (input.clientId === PLATFORM_CLIENT_ID) {
      return ok({ applied: false });
    }

    let machine: MachineIdentity | null;
    try {
      // Identity only — no state (`status`, the clock) is read here. Basing
      // any decision on a value read outside the conditional write below is
      // exactly the race the guard above exists to prevent.
      machine = (await db.machine.findUnique({
        where: { id: input.clientId },
        select: { id: true, tenantId: true },
      })) as MachineIdentity | null;
    } catch {
      // A clientid that isn't even a well-formed uuid makes Prisma throw on
      // the `@db.Uuid` column — just as unresolvable as one it returns null
      // for. Normal traffic (a diagnostics client, a typo), not an error.
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

      // Stamped from the resolved machine's own tenant, never from the
      // request body, which carries no tenant id at all.
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
      return ok({ applied: true });
    }

    // Not a transition — either the status already matched (a no-op that
    // still needs its clock advanced, see the module comment) or the event
    // was stale and this correctly does nothing.
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
