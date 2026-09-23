import { beforeEach, describe, expect, it, vi } from "vitest";

const { publish, commandFindMany, machineFindFirst } = vi.hoisted(() => ({
  publish: vi.fn(),
  commandFindMany: vi.fn(),
  machineFindFirst: vi.fn(),
}));

vi.mock("@/mqtt/client", () => ({ publishToBroker: publish }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    machineCommand: { findMany: commandFindMany },
    machine: { findFirst: machineFindFirst },
  },
}));

import { publishCommand, redeliverOpenCommands } from "@/mqtt/commands";

const MACHINE = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: "11111111-1111-4111-8111-111111111111",
  siteId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  publish.mockReset();
  commandFindMany.mockReset();
  machineFindFirst.mockReset();
});

describe("publishCommand", () => {
  it("addresses the machine's own commands topic, with the command id as the last segment", async () => {
    await publishCommand(MACHINE, { type: "apply_configuration", version: 4 }, "cfg-1");

    const [topic] = publish.mock.calls[0];
    expect(topic).toBe(`v1/${MACHINE.tenantId}/${MACHINE.siteId}/${MACHINE.id}/commands/cfg-1`);
  });

  // A broker that is down must not fail a publish whose rows are already stored;
  // the reconnect hook delivers it later.
  it("swallows a broker failure rather than throwing", async () => {
    publish.mockRejectedValue(new Error("broker down"));

    await expect(publishCommand(MACHINE, { type: "apply_configuration", version: 4 }, "cfg-1")).resolves.toBeUndefined();
  });
});

describe("redeliverOpenCommands", () => {
  it("republishes the machine's pending, unexpired commands", async () => {
    machineFindFirst.mockResolvedValue(MACHINE);
    commandFindMany.mockResolvedValue([
      { commandId: "cfg-1", type: "apply_configuration", payload: { version: 4 } },
      { commandId: "cfg-2", type: "apply_configuration", payload: { version: 5 } },
    ]);

    const count = await redeliverOpenCommands(MACHINE.id);

    expect(count).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("only considers pending commands that have not expired", async () => {
    machineFindFirst.mockResolvedValue(MACHINE);
    commandFindMany.mockResolvedValue([]);

    await redeliverOpenCommands(MACHINE.id);

    const { where } = commandFindMany.mock.calls[0][0];
    expect(where.status).toBe("pending");
    expect(where.expiresAt).toHaveProperty("gt");
  });

  it("does nothing for a machine that no longer resolves", async () => {
    machineFindFirst.mockResolvedValue(null);

    expect(await redeliverOpenCommands(MACHINE.id)).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  // Task 7's publisher guards the same way (no tenant/site, no topic), and the
  // two halves must agree: a machine mid-onboarding has nothing to redeliver to.
  it("does nothing for a machine with no tenant or site to publish on", async () => {
    machineFindFirst.mockResolvedValue({ ...MACHINE, tenantId: null, siteId: null });

    expect(await redeliverOpenCommands(MACHINE.id)).toBe(0);
    expect(commandFindMany).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  // The un-awaited caller in connection.service.ts has nothing to attach a
  // .catch() to — this must never reject, however the database fails.
  it("never rejects, even when the database call itself fails", async () => {
    machineFindFirst.mockRejectedValue(new Error("connection refused"));

    await expect(redeliverOpenCommands(MACHINE.id)).resolves.toBe(0);
  });
});
