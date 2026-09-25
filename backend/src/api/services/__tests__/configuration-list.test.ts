import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineFindFirst, configFindMany, configFindFirst, userFindMany } = vi.hoisted(() => ({
  machineFindFirst: vi.fn(),
  configFindMany: vi.fn(),
  configFindFirst: vi.fn(),
  userFindMany: vi.fn(),
}));

// A separate mock shape from configuration-publish.test.ts's on purpose:
// listConfigurationsService calls prisma.machineConfiguration.findMany/findFirst
// and prisma.user.findMany directly (no $transaction, no `tx`), which is a
// different surface of the prisma mock than the publish flow exercises.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findFirst: machineFindFirst },
    machineConfiguration: { findMany: configFindMany, findFirst: configFindFirst },
    user: { findMany: userFindMany },
  },
}));

import { listConfigurationsService } from "@/api/services/configuration.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const USER_A = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  for (const fn of [machineFindFirst, configFindMany, configFindFirst, userFindMany]) fn.mockReset();
  // Every test below is about the history of a machine that exists; the one
  // exception (machine not found) overrides this itself. `slots: []` is the
  // shape Prisma actually returns for a machine with no rows in that relation
  // — a test that cares about drift overrides this with real slots.
  machineFindFirst.mockResolvedValue({ id: MACHINE, stepsPerVend: 6400, slots: [] });
  // Most of the tests below are about the version list, not drift; a machine
  // with no configuration at all is a safe default so `latest` stays null.
  configFindFirst.mockResolvedValue(null);
  // The user lookup always runs, even for an empty version list (looking up
  // an empty set of ids); tests that care about the result override this.
  userFindMany.mockResolvedValue([]);
});

describe("listConfigurationsService", () => {
  it("asks the database for newest-first, rather than sorting in memory", async () => {
    configFindMany.mockResolvedValue([
      { version: 3, createdAt: new Date("2026-01-03"), createdById: null },
      { version: 2, createdAt: new Date("2026-01-02"), createdById: null },
      { version: 1, createdAt: new Date("2026-01-01"), createdById: null },
    ]);
    userFindMany.mockResolvedValue([]);

    const [error, result] = await listConfigurationsService(MACHINE);

    expect(error).toBeNull();
    expect(configFindMany.mock.calls[0][0].orderBy).toEqual({ version: "desc" });
    expect(result?.versions.map((row) => row.version)).toEqual([3, 2, 1]);
  });

  // The list is a chooser for the rollback control, not a page of the machine's
  // configuration history to read — a page of full payloads would be kilobytes
  // of JSON nobody reads.
  it("does not select the payload column", async () => {
    configFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);

    await listConfigurationsService(MACHINE);

    expect(configFindMany.mock.calls[0][0].select).toEqual({
      version: true,
      createdAt: true,
      createdById: true,
    });
    expect(configFindMany.mock.calls[0][0].select.payload).toBeUndefined();
  });

  it("answers createdBy: null for a configuration with no signed-in publisher", async () => {
    configFindMany.mockResolvedValue([{ version: 1, createdAt: new Date("2026-01-01"), createdById: null }]);
    userFindMany.mockResolvedValue([]);

    const [error, result] = await listConfigurationsService(MACHINE);

    expect(error).toBeNull();
    expect(result?.versions[0].createdBy).toBeNull();
  });

  it("resolves a createdById to that user's name", async () => {
    configFindMany.mockResolvedValue([{ version: 1, createdAt: new Date("2026-01-01"), createdById: USER_A }]);
    userFindMany.mockResolvedValue([{ id: USER_A, name: "Ada Lovelace" }]);

    const [error, result] = await listConfigurationsService(MACHINE);

    expect(error).toBeNull();
    expect(result?.versions[0].createdBy).toEqual({ name: "Ada Lovelace" });
  });

  // createdById pointing at a user row that no longer resolves (deleted user,
  // stale reference) must fall back to a label, not throw and turn the whole
  // history into an error page.
  it("falls back to Unknown when createdById names no user the lookup returns", async () => {
    configFindMany.mockResolvedValue([{ version: 1, createdAt: new Date("2026-01-01"), createdById: USER_A }]);
    userFindMany.mockResolvedValue([]);

    const [error, result] = await listConfigurationsService(MACHINE);

    expect(error).toBeNull();
    expect(result?.versions[0].createdBy).toEqual({ name: "Unknown" });
  });

  // pin_for()-style bug class, but for this lookup: a machine republished many
  // times by the same person must not turn into one `user.findMany` call per
  // row, and must not send duplicate ids either.
  it("dedupes createdById before looking users up", async () => {
    configFindMany.mockResolvedValue([
      { version: 2, createdAt: new Date("2026-01-02"), createdById: USER_A },
      { version: 1, createdAt: new Date("2026-01-01"), createdById: USER_A },
    ]);
    userFindMany.mockResolvedValue([{ id: USER_A, name: "Ada Lovelace" }]);

    await listConfigurationsService(MACHINE);

    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany.mock.calls[0][0].where.id.in).toEqual([USER_A]);
  });

  // Without this check, an unknown machine id reads as "nothing published
  // yet" (200 []) rather than 404 -- the same distinction the publish path
  // already makes for the same id.
  it("answers MACHINE_NOT_FOUND for a machine that does not exist", async () => {
    machineFindFirst.mockResolvedValue(null);

    const [error, result] = await listConfigurationsService(MACHINE);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
    expect(result).toBeNull();
    expect(configFindMany).not.toHaveBeenCalled();
  });
});

describe("listConfigurationsService — drift", () => {
  // Dropping `machineId` from this `where` would compare a machine's stored
  // rows against another machine's published payload, and flipping `orderBy`
  // to ascending would compare against v1 forever — both would still pass
  // every drift test above, since those only control what configFindFirst
  // resolves to, not what it was asked for.
  it("asks for the newest version of this machine's own configuration", async () => {
    machineFindFirst.mockResolvedValue({ id: MACHINE, stepsPerVend: 6400, slots: [] });
    configFindMany.mockResolvedValue([]);
    configFindFirst.mockResolvedValue(null);

    await listConfigurationsService(MACHINE);

    expect(configFindFirst.mock.calls[0][0].where).toEqual({ machineId: MACHINE });
    expect(configFindFirst.mock.calls[0][0].orderBy).toEqual({ version: "desc" });
  });

  it("reports null drift when nothing has been published", async () => {
    machineFindFirst.mockResolvedValue({ id: MACHINE, stepsPerVend: 6400, slots: [] });
    configFindMany.mockResolvedValue([]);
    configFindFirst.mockResolvedValue(null);

    const [error, result] = await listConfigurationsService(MACHINE);

    expect(error).toBeNull();
    expect(result?.drift).toBeNull();
  });

  it("reports no drift when the current rows match the latest version", async () => {
    machineFindFirst.mockResolvedValue({
      id: MACHINE,
      stepsPerVend: 6400,
      slots: [{ slotNumber: 1, price: "15.00", product: null, pins: [{ number: 18 }] }],
    });
    configFindMany.mockResolvedValue([{ version: 1, createdAt: new Date(), createdById: null }]);
    configFindFirst.mockResolvedValue({
      payload: {
        cash: {},
        prices: [{ slot: 1, priceMinor: 1500 }],
        wiring: { version: 2, motor: { stepsPerVend: 6400 }, slots: [{ slot: 1, pins: [18] }] },
      },
    });
    userFindMany.mockResolvedValue([]);

    const [, result] = await listConfigurationsService(MACHINE);

    expect(result?.drift).toEqual({ wiring: false, prices: false });
  });

  // A distinct stepsPerVend on the machine row vs. the stored payload, with
  // otherwise identical wiring, proves drift is actually driven by the
  // machine's own stepsPerVend rather than a value baked into the test fixtures.
  it("reports a wiring difference when stepsPerVend has changed since the last version", async () => {
    machineFindFirst.mockResolvedValue({
      id: MACHINE,
      stepsPerVend: 3200,
      slots: [{ slotNumber: 1, price: "15.00", product: null, pins: [{ number: 18 }] }],
    });
    configFindMany.mockResolvedValue([{ version: 1, createdAt: new Date(), createdById: null }]);
    configFindFirst.mockResolvedValue({
      payload: {
        cash: {},
        prices: [{ slot: 1, priceMinor: 1500 }],
        wiring: { version: 2, motor: { stepsPerVend: 6400 }, slots: [{ slot: 1, pins: [18] }] },
      },
    });
    userFindMany.mockResolvedValue([]);

    const [, result] = await listConfigurationsService(MACHINE);

    expect(result?.drift).toEqual({ wiring: true, prices: false });
  });

  it("reports a wiring difference when a pin has changed since the last version", async () => {
    machineFindFirst.mockResolvedValue({
      id: MACHINE,
      stepsPerVend: 6400,
      slots: [{ slotNumber: 1, price: "15.00", product: null, pins: [{ number: 19 }] }],
    });
    configFindMany.mockResolvedValue([{ version: 1, createdAt: new Date(), createdById: null }]);
    configFindFirst.mockResolvedValue({
      payload: {
        cash: {},
        prices: [{ slot: 1, priceMinor: 1500 }],
        wiring: { version: 2, motor: { stepsPerVend: 6400 }, slots: [{ slot: 1, pins: [18] }] },
      },
    });
    userFindMany.mockResolvedValue([]);

    const [, result] = await listConfigurationsService(MACHINE);

    expect(result?.drift).toEqual({ wiring: true, prices: false });
  });
});
