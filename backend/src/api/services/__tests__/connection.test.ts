import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAlertService, broadcast } = vi.hoisted(() => ({
  createAlertService: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("@/api/services/alerts.service", () => ({ createAlertService }));
vi.mock("@/lib/ws/registry", () => ({ broadcast }));
vi.mock("@/mqtt/commands", () => ({ redeliverOpenCommands: vi.fn() }));

import {
  CONNECTION_EVENT_TYPES,
  type ConnectionDb,
  PLATFORM_CLIENT_ID,
  recordConnectionEventService,
} from "@/api/services/connection.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const MACHINE = "33333333-3333-4333-8333-333333333333";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-01-01T00:00:10.000Z");
const T2 = new Date("2026-01-01T00:00:20.000Z");
const T3 = new Date("2026-01-01T00:00:30.000Z");
const T_BEFORE = new Date("2025-12-31T23:59:00.000Z");

/**
 * A minimal in-memory `machines` row plus a real conditional `updateMany`
 * (the exact predicate `recordConnectionEventService` sends), so the
 * concurrency/ordering tests exercise the same guard the real database
 * evaluates, not a mock that always agrees with the caller.
 */
function fakeDb(overrides: {
  machine?: { id: string; tenantId: string | null; status: string; lastConnectionEventAt: Date | null } | null | (() => unknown);
} = {}) {
  const machineRow =
    overrides.machine === undefined
      ? { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: null as Date | null }
      : overrides.machine;

  const findUnique =
    typeof machineRow === "function" ? vi.fn(machineRow) : vi.fn(async (_args: unknown) => machineRow);

  // Real row state this fake maintains, so `updateMany`'s WHERE can be
  // evaluated against it exactly like Postgres would — including the case
  // where an earlier call in the same test already moved it.
  let row = typeof machineRow === "function" ? null : (machineRow as { id: string; tenantId: string | null; status: string; lastConnectionEventAt: Date | null } | null);

  const create = vi.fn(async (_args: unknown) => ({}));

  // Evaluates exactly the `where` object the service sends, field by field —
  // it must not know in advance which guards a correct implementation
  // "should" apply, or a mutation that drops one of them would sail through
  // undetected (a mock that always agrees with the caller isn't a test).
  const updateMany = vi.fn(async (args: any) => {
    if (!row || row.id !== args.where.id) return { count: 0 };

    if (args.where.status !== undefined) {
      const matches =
        typeof args.where.status === "object" ? row.status !== args.where.status.not : row.status === args.where.status;
      if (!matches) return { count: 0 };
    }

    // Only enforced if the service's own `where` actually asked for it —
    // if a mutation removes the `...notStale` spread, `args.where.OR` is
    // `undefined` here and this must impose NO staleness check at all,
    // exactly like a real database wouldn't either.
    if (args.where.OR !== undefined) {
      const satisfiesClause = (clause: { lastConnectionEventAt: null | { lt: Date } }) =>
        clause.lastConnectionEventAt === null
          ? row!.lastConnectionEventAt === null
          : row!.lastConnectionEventAt !== null && row!.lastConnectionEventAt.getTime() < clause.lastConnectionEventAt.lt.getTime();

      const notStale = (args.where.OR as { lastConnectionEventAt: null | { lt: Date } }[]).some(satisfiesClause);
      if (!notStale) return { count: 0 };
    }

    row = { ...row, ...args.data };
    return { count: 1 };
  });

  const db = {
    machine: { findUnique, updateMany },
    machineEvent: { create },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ machine: { updateMany }, machineEvent: { create } })),
  };

  return { db: db as unknown as ConnectionDb & typeof db, findUnique, updateMany, create, getRow: () => row };
}

beforeEach(() => {
  createAlertService.mockReset().mockResolvedValue([null, null]);
  broadcast.mockReset();
});

describe("recordConnectionEventService", () => {
  it("ignores the platform client without even looking it up", async () => {
    const { db, findUnique } = fakeDb();

    const [error, result] = await recordConnectionEventService(db, {
      clientId: PLATFORM_CLIENT_ID,
      status: "online",
      occurredAt: T0,
    });

    expect(error).toBeNull();
    expect(result?.applied).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("ignores a clientid that does not resolve to a machine", async () => {
    const { db, updateMany, create } = fakeDb({ machine: null });

    const [error, result] = await recordConnectionEventService(db, {
      clientId: "not-a-real-machine",
      status: "online",
      occurredAt: T0,
    });

    expect(error).toBeNull();
    expect(result?.applied).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores a clientid that is not even a well-formed uuid, without throwing", async () => {
    const { db, updateMany } = fakeDb({
      machine: () => {
        throw new Error("invalid input syntax for type uuid");
      },
    });

    const [error, result] = await recordConnectionEventService(db, {
      clientId: "not-a-uuid",
      status: "online",
      occurredAt: T0,
    });

    expect(error).toBeNull();
    expect(result?.applied).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("writes online and a history event when a currently-offline machine reconnects", async () => {
    const { db, create, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "offline", lastConnectionEventAt: null },
    });

    const [error, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "online",
      occurredAt: T0,
    });

    expect(error).toBeNull();
    expect(result?.applied).toBe(true);
    expect(getRow()).toMatchObject({ status: "online", lastConnectionEventAt: T0 });
    expect(create).toHaveBeenCalledWith({
      data: {
        machineId: MACHINE,
        tenantId: TENANT,
        type: CONNECTION_EVENT_TYPES.online,
        payload: {},
        occurredAt: T0,
      },
    });
  });

  /**
   * `never_seen` is the state a machine rests in until its certificate has ever
   * reached the broker (see the backfill migration). It is never an INPUT here
   * — only ever a prior state — so what these two pin down is that the service
   * treats it as an ordinary status it may transition away from, and in
   * particular that a machine's very first broker event is recorded as history
   * rather than swallowed as a no-op.
   */
  it("writes online and a history event when a never-seen machine connects for the first time", async () => {
    const { db, create, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "never_seen", lastConnectionEventAt: null },
    });

    const [error, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "online",
      occurredAt: T0,
    });

    expect(error).toBeNull();
    expect(result?.applied).toBe(true);
    expect(getRow()).toMatchObject({ status: "online", lastConnectionEventAt: T0 });
    expect(create).toHaveBeenCalledWith({
      data: {
        machineId: MACHINE,
        tenantId: TENANT,
        type: CONNECTION_EVENT_TYPES.online,
        payload: {},
        occurredAt: T0,
      },
    });
  });

  it("writes offline and a history event when a never-seen machine's first event is a disconnect", async () => {
    const { db, create, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "never_seen", lastConnectionEventAt: null },
    });

    const [, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "offline",
      occurredAt: T0,
      reason: "tcp_closed",
    });

    expect(result?.applied).toBe(true);
    expect(getRow()).toMatchObject({ status: "offline", lastConnectionEventAt: T0 });
    expect(create).toHaveBeenCalledWith({
      data: {
        machineId: MACHINE,
        tenantId: TENANT,
        type: CONNECTION_EVENT_TYPES.offline,
        payload: { reason: "tcp_closed" },
        occurredAt: T0,
      },
    });
  });

  it("writes offline with the disconnect reason when a currently-online machine disconnects", async () => {
    const { db, create, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: null },
    });

    const [, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "offline",
      occurredAt: T0,
      reason: "keepalive_timeout",
    });

    expect(result?.applied).toBe(true);
    expect(getRow()).toMatchObject({ status: "offline", lastConnectionEventAt: T0 });
    expect(create).toHaveBeenCalledWith({
      data: {
        machineId: MACHINE,
        tenantId: TENANT,
        type: CONNECTION_EVENT_TYPES.offline,
        payload: { reason: "keepalive_timeout" },
        occurredAt: T0,
      },
    });
  });

  it("does not write a history event when the reported status already matches, but still advances the clock", async () => {
    const { db, create, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: null },
    });

    const [, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "online",
      occurredAt: T0,
    });

    expect(result?.applied).toBe(false);
    expect(create).not.toHaveBeenCalled();
    // The clock still moved even though nothing "transitioned" — this is
    // what closes finding 1 below.
    expect(getRow()).toMatchObject({ status: "online", lastConnectionEventAt: T0 });
  });

  it("does not advance the clock for a stale no-op (status already matches, but the event is older than the clock)", async () => {
    const { db, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: T2 },
    });

    const [, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "online",
      occurredAt: T1,
    });

    expect(result?.applied).toBe(false);
    // Must NOT have been overwritten backwards to T1.
    expect(getRow()).toMatchObject({ status: "online", lastConnectionEventAt: T2 });
  });

  it("drops an event older than the machine's last recorded transition", async () => {
    const { db, create, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: T1 },
    });

    const [, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "offline",
      occurredAt: T_BEFORE,
    });

    expect(result?.applied).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(getRow()).toMatchObject({ status: "online", lastConnectionEventAt: T1 });
  });

  it("drops an event whose timestamp exactly equals the recorded clock (idempotent retry)", async () => {
    const { db, create, getRow } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "offline", lastConnectionEventAt: T1 },
    });

    const [, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "online",
      occurredAt: T1,
    });

    expect(result?.applied).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(getRow()).toMatchObject({ status: "offline", lastConnectionEventAt: T1 });
  });

  it("applies an event that is newer than the machine's last recorded transition", async () => {
    const { db, updateMany } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: T0 },
    });

    const [, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "offline",
      occurredAt: T1,
    });

    expect(result?.applied).toBe(true);
    expect(updateMany).toHaveBeenCalled();
  });

  // Finding 1 (fix-round-1 review): the clock must advance on a no-op, or an
  // older event still in flight behind it gets waved through as "newer than
  // the clock" once it, in turn, arrives.
  it("REGRESSION (finding 1): a no-op reconnect advances the clock, so an older reordered disconnect behind it is dropped", async () => {
    const { db, create, getRow } = fakeDb({
      // Machine is online, with its clock already at T1 (its last applied
      // transition, `machine-online@T1`).
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: T1 },
    });

    // A genuine disconnect@T2 and reconnect@T3 (T1 < T2 < T3) arrive
    // REORDERED: the reconnect lands first.
    const [, connectResult] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "online",
      occurredAt: T3,
    });
    expect(connectResult?.applied).toBe(false); // no-op: already online
    // The clock must have moved to T3 even though nothing "transitioned".
    expect(getRow()).toMatchObject({ status: "online", lastConnectionEventAt: T3 });

    // The disconnect@T2 arrives after. T2 is now BEFORE the clock (T3), so
    // it must be dropped as stale rather than applied on top of a machine
    // that has since (re)confirmed it is online.
    const [, disconnectResult] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "offline",
      occurredAt: T2,
    });

    expect(disconnectResult?.applied).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(getRow()).toMatchObject({ status: "online", lastConnectionEventAt: T3 });
  });

  // Finding 2 (fix-round-1 review): the conditional `updateMany` is the
  // atomicity boundary. A losing race must look exactly like a stale event —
  // count 0, no event, no status change — never a duplicate or a lost update.
  it("REGRESSION (finding 2): a losing conditional write (count 0) applies nothing and writes no event", async () => {
    const { db, updateMany, create } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: null },
    });

    // Force the conditional write to lose regardless of predicate, standing
    // in for "another request's write already committed and moved the row
    // past this one's guard" — the scenario the real `updateMany` handles by
    // re-evaluating its WHERE against the just-committed row.
    updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    const [error, result] = await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "offline",
      occurredAt: T0,
    });

    expect(error).toBeNull();
    expect(result?.applied).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("recordConnectionEventService — offline alert", () => {
  it("raises an offline alert at the broker's disconnect time and pushes it to the tenant", async () => {
    const row = { id: "a-1" };
    createAlertService.mockResolvedValue([null, row]);
    const { db } = fakeDb();

    await recordConnectionEventService(db, {
      clientId: MACHINE,
      status: "offline",
      occurredAt: T0,
      reason: "keepalive_timeout",
    });

    expect(createAlertService).toHaveBeenCalledWith({
      machineId: MACHINE,
      type: "offline",
      message: "Machine went offline (keepalive_timeout)",
      occurredAt: T0,
    });
    expect(broadcast).toHaveBeenCalledWith(TENANT, { type: "alert.created", body: row });
  });

  it("does not raise an alert when the machine was already offline", async () => {
    const { db } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "offline", lastConnectionEventAt: null },
    });

    await recordConnectionEventService(db, { clientId: MACHINE, status: "offline", occurredAt: T0 });

    expect(createAlertService).not.toHaveBeenCalled();
  });

  it("does not raise an alert for a stale disconnect", async () => {
    const { db } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "online", lastConnectionEventAt: T1 },
    });

    await recordConnectionEventService(db, { clientId: MACHINE, status: "offline", occurredAt: T_BEFORE });

    expect(createAlertService).not.toHaveBeenCalled();
  });

  it("does not raise an alert when a machine comes online", async () => {
    const { db } = fakeDb({
      machine: { id: MACHINE, tenantId: TENANT, status: "offline", lastConnectionEventAt: null },
    });

    await recordConnectionEventService(db, { clientId: MACHINE, status: "online", occurredAt: T0 });

    expect(createAlertService).not.toHaveBeenCalled();
  });

  it("does not raise an alert for a machine that belongs to no tenant", async () => {
    const { db } = fakeDb({
      machine: { id: MACHINE, tenantId: null, status: "online", lastConnectionEventAt: null },
    });

    await recordConnectionEventService(db, { clientId: MACHINE, status: "offline", occurredAt: T0 });

    expect(createAlertService).not.toHaveBeenCalled();
  });

  it("answers the error when the alert cannot be stored", async () => {
    createAlertService.mockResolvedValue([{ reason: "UNKNOWN_ERROR", message: "db down" }, null]);
    const { db } = fakeDb();

    const [error] = await recordConnectionEventService(db, { clientId: MACHINE, status: "offline", occurredAt: T0 });

    expect(error).toEqual({ reason: "UNKNOWN_ERROR", message: "db down" });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
