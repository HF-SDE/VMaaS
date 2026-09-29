import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAlertService } = vi.hoisted(() => ({ createAlertService: vi.fn() }));
vi.mock("../alerts.service", () => ({ createAlertService }));

import {
  CONFIGURATION_ALERT_PREFIX,
  reportConfigurationResultService,
  watchPriceCommand,
} from "../configuration-sync.service";

/**
 * A price a customer changed has to reach the machine: the machine sells at
 * the price it has, and the sale is booked at that price. So the admin is told
 * the outcome over the websocket, and a price that did not arrive while the
 * machine was online becomes an alert the whole team sees until a later
 * configuration is applied.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const MACHINE = "33333333-3333-4333-8333-333333333333";

const alertRow = { id: "a-1", type: "error", machineId: MACHINE, machineName: "Lobby" };

beforeEach(() => {
  createAlertService.mockReset();
  createAlertService.mockImplementation(async (input: { message: string }) => [null, { ...alertRow, message: input.message }]);
});

function fakeDb(options: { machineStatus?: string; commandStatus?: string } = {}) {
  return {
    machine: { findUnique: vi.fn().mockResolvedValue({ status: options.machineStatus ?? "online" }) },
    machineCommand: { findFirst: vi.fn().mockResolvedValue({ status: options.commandStatus ?? "sent" }) },
    securityAlert: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe("reportConfigurationResultService", () => {
  it("tells the tenant a configuration was applied and resolves open configuration alerts", async () => {
    const db = fakeDb();
    const broadcast = vi.fn();

    await reportConfigurationResultService(db as never, broadcast, {
      tenantId: TENANT,
      machineId: MACHINE,
      commandId: "cfg-1",
      status: "completed",
      detail: "applied v4",
    });

    expect(broadcast).toHaveBeenCalledWith(TENANT, {
      type: "configuration.result",
      body: { commandId: "cfg-1", machineId: MACHINE, status: "completed", detail: "applied v4" },
    });
    const update = db.securityAlert.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({
      machineId: MACHINE,
      type: "error",
      resolvedAt: null,
      message: { startsWith: CONFIGURATION_ALERT_PREFIX },
    });
    expect(createAlertService).not.toHaveBeenCalled();
  });

  it("raises an alert when the machine reports a failure, and broadcasts it", async () => {
    const db = fakeDb();
    const broadcast = vi.fn();

    await reportConfigurationResultService(db as never, broadcast, {
      tenantId: TENANT,
      machineId: MACHINE,
      commandId: "cfg-1",
      status: "failed",
      detail: "v4 prices applied, wiring rejected (no reply)",
    });

    const created = createAlertService.mock.calls[0][0];
    expect(created).toMatchObject({ machineId: MACHINE, type: "error" });
    expect(created.message).toBe(
      `${CONFIGURATION_ALERT_PREFIX}: v4 prices applied, wiring rejected (no reply)`,
    );
    const types = broadcast.mock.calls.map((c) => c[1].type);
    expect(types).toEqual(["configuration.result", "alert.created"]);
    expect(db.securityAlert.updateMany).not.toHaveBeenCalled();
  });

  it("says nothing to a tenant-less machine's nobody", async () => {
    const db = fakeDb();
    const broadcast = vi.fn();

    await reportConfigurationResultService(db as never, broadcast, {
      tenantId: null,
      machineId: MACHINE,
      commandId: "cfg-1",
      status: "failed",
      detail: null,
    });

    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe("watchPriceCommand", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("raises an alert when an online machine has not answered within the timeout", async () => {
    const db = fakeDb({ machineStatus: "online", commandStatus: "sent" });
    const broadcast = vi.fn();

    watchPriceCommand(db as never, broadcast, { tenantId: TENANT, machineId: MACHINE, commandId: "cfg-1" }, 60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(createAlertService).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(db.machineCommand.findFirst.mock.calls[0][0].where).toEqual({ commandId: "cfg-1", machineId: MACHINE });
    expect(createAlertService.mock.calls[0][0].message).toBe(
      `${CONFIGURATION_ALERT_PREFIX}: no answer from the machine within 60 s`,
    );
    expect(broadcast.mock.calls.map((c) => c[1].type)).toEqual(["alert.created"]);
  });

  it("stays quiet once the machine has answered", async () => {
    const db = fakeDb({ machineStatus: "online", commandStatus: "completed" });
    const broadcast = vi.fn();

    watchPriceCommand(db as never, broadcast, { tenantId: TENANT, machineId: MACHINE, commandId: "cfg-1" }, 60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(createAlertService).not.toHaveBeenCalled();
  });

  it("stays quiet when the machine went offline meanwhile: it will pick the price up on reconnect", async () => {
    const db = fakeDb({ machineStatus: "offline", commandStatus: "pending" });
    const broadcast = vi.fn();

    watchPriceCommand(db as never, broadcast, { tenantId: TENANT, machineId: MACHINE, commandId: "cfg-1" }, 60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(createAlertService).not.toHaveBeenCalled();
  });
});
