import { describe, expect, it, vi } from "vitest";

import { type HandlerDb, handleCommandResult } from "@/mqtt/handlers";
import { parseTopic } from "@/mqtt/topics";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const PREFIX = `v1/${TENANT}/${SITE}/${MACHINE}`;

// Mocks take an explicit (and unused) `_args: unknown` parameter, matching
// HandlerDb's signature, so `mock.calls[0][0]` type-checks under `tsc
// --noEmit` (a zero-arg arrow makes vitest infer a zero-arg mock, whose
// `.mock.calls` entries are the empty tuple `[]` — `calls[0][0]` would not
// compile even though vitest itself runs it fine).
function fakeDb(overrides: Record<string, unknown> = {}) {
  const db = {
    machine: {
      findFirst: vi.fn(async (_args: unknown) => ({ id: MACHINE, tenantId: TENANT, siteId: SITE, disabledAt: null })),
    },
    machineCommand: {
      update: vi.fn(async (_args: unknown) => ({})),
      findFirst: vi.fn(async (_args: unknown) => ({ id: "row-1", status: "sent", machineId: MACHINE })),
    },
    machineEvent: { create: vi.fn(async (_args: unknown) => ({})) },
    // Default: run the callback against `db` itself, so a wrapped write hits the
    // same spies a direct write would. Tests that care about rollback override
    // this with a staging implementation.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    ...overrides,
  };
  return db as unknown as HandlerDb & typeof db;
}

describe("handleCommandResult", () => {
  const topic = parseTopic(`${PREFIX}/command-results/cmd-9281`)!;

  it("completes the command and writes a setup-confirmed event", async () => {
    const db = fakeDb();

    await handleCommandResult(db, topic, { status: "completed", completedAt: new Date().toISOString() });

    expect(db.machineCommand.update).toHaveBeenCalled();
    const event = db.machineEvent.create.mock.calls[0][0] as { data: { type: string } };
    expect(event.data.type).toBe("setup-confirmed");
  });

  it("fails the command and writes a setup-failed event", async () => {
    const db = fakeDb();

    await handleCommandResult(db, topic, { status: "failed", detail: "self-test failed" });

    const event = db.machineEvent.create.mock.calls[0][0] as { data: { type: string } };
    expect(event.data.type).toBe("setup-failed");
  });

  it("ignores a result for a command belonging to another machine", async () => {
    const db = fakeDb({
      machineCommand: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(),
        update: vi.fn(),
      },
    });

    await handleCommandResult(db, topic, { status: "completed" });

    expect(db.machineCommand.update).not.toHaveBeenCalled();
    expect(db.machineEvent.create).not.toHaveBeenCalled();
  });

  it("ignores a replayed result for a command already finished", async () => {
    const db = fakeDb({
      machineCommand: {
        findFirst: vi.fn(async () => ({ id: "row-1", status: "completed", machineId: MACHINE })),
        create: vi.fn(),
        update: vi.fn(),
      },
    });

    await handleCommandResult(db, topic, { status: "failed" });

    expect(db.machineCommand.update).not.toHaveBeenCalled();
  });

  it("looks the command up by both its id and the topic's machine", async () => {
    const db = fakeDb();

    await handleCommandResult(db, topic, { status: "completed" });

    const args = db.machineCommand.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ commandId: "cmd-9281", machineId: MACHINE });
  });

  it("does nothing when the topic's machine does not exist", async () => {
    const db = fakeDb({ machine: { findFirst: vi.fn(async () => null) } });

    await handleCommandResult(db, topic, { status: "completed" });

    expect(db.machineCommand.findFirst).not.toHaveBeenCalled();
    expect(db.machineCommand.update).not.toHaveBeenCalled();
  });

  it("applies a result for a command still pending", async () => {
    const db = fakeDb({
      machineCommand: {
        findFirst: vi.fn(async () => ({ id: "row-1", status: "pending", machineId: MACHINE })),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
    });

    await handleCommandResult(db, topic, { status: "completed" });

    expect(db.machineCommand.update).toHaveBeenCalled();
    expect(db.machineEvent.create).toHaveBeenCalled();
  });

  // I1: the command settle and the event write must be one atomic unit. If the
  // event write fails, the command must stay open so a replay can re-settle it;
  // otherwise isCommandOpen short-circuits every replay and the event is lost.
  it("leaves the command open when the event write fails", async () => {
    const eventError = new Error("event write failed");
    // Models real transaction semantics: the command update only "commits" if
    // the whole callback resolves. A direct (unwrapped) update commits at once.
    const committed = { commandUpdated: false };
    const staged: Array<() => void> = [];
    const tx = {
      machineCommand: {
        update: vi.fn(async () => {
          staged.push(() => {
            committed.commandUpdated = true;
          });
          return {};
        }),
      },
      machineEvent: {
        create: vi.fn(async () => {
          throw eventError;
        }),
      },
    };
    const db = fakeDb({
      machineCommand: {
        findFirst: vi.fn(async () => ({ id: "row-1", status: "sent", machineId: MACHINE })),
        create: vi.fn(),
        // The direct path, reached only if the transaction wrapper is removed:
        // it commits immediately, before the failing event write.
        update: vi.fn(async () => {
          committed.commandUpdated = true;
          return {};
        }),
      },
      machineEvent: {
        create: vi.fn(async () => {
          throw eventError;
        }),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        try {
          const result = await fn(tx);
          for (const apply of staged) apply();
          return result;
        } catch (error) {
          staged.length = 0;
          throw error;
        }
      }),
    });

    await expect(handleCommandResult(db, topic, { status: "completed" })).rejects.toThrow(eventError);
    // The command update was rolled back with the failed event, so the command
    // is still open for the next replay.
    expect(committed.commandUpdated).toBe(false);
  });
});
