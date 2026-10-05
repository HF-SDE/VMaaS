import { describe, expect, it, vi } from "vitest";

import { recordDeviceEventService } from "../device.service";

/**
 * A cash sale is money that has already changed hands: the coin was in the box
 * before this request existed, and the device cannot be told to undo it. So the
 * only two things that matter here are that one event produces exactly one
 * Sale, and that a replay produces none.
 */

const machine = { id: "m-1", tenantId: "t-1" } as never;

function fakeDb() {
  const tx = {
    machineEvent: { create: vi.fn().mockResolvedValue({ id: "e-1" }) },
    sale: { create: vi.fn().mockResolvedValue({ id: "s-1" }) },
    inventoryMovement: {
      create: vi.fn().mockResolvedValue({ id: "i-1" }),
      // The slot's last count; none by default, so every completed sale decrements.
      findFirst: vi.fn().mockResolvedValue(null),
    },
    slot: {
      findFirst: vi.fn().mockResolvedValue({ id: "slot-1", productId: "p-1" }),
      update: vi.fn().mockResolvedValue({ id: "slot-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  return {
    tx,
    db: {
      machineEvent: tx.machineEvent,
      sale: tx.sale,
      inventoryMovement: tx.inventoryMovement,
      slot: tx.slot,
      machineCommand: { findFirst: vi.fn(), update: vi.fn() },
      machineCertificate: { create: vi.fn(), update: vi.fn() },
      machineConfiguration: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    } as never,
  };
}

function completedEvent() {
  return {
    type: "cash_sale",
    eventId: "VM-16FEE909-000412",
    sequenceNumber: 412,
    occurredAt: "2026-09-21T13:04:11Z",
    payload: {
      slot: 12,
      price_minor: 1500,
      received_minor: 2000,
      status: "completed",
      currency: "DKK",
      ledger: "k3f9x2a1",
    },
  } as never;
}

describe("recordDeviceEventService, cash_sale", () => {
  it("writes a completed Sale and decrements the slot", async () => {
    const { tx, db } = fakeDb();

    const [error] = await recordDeviceEventService(db, machine, completedEvent());

    expect(error).toBeNull();
    expect(tx.sale.create).toHaveBeenCalledTimes(1);

    const sale = tx.sale.create.mock.calls[0][0].data;
    expect(sale.status).toBe("completed");
    expect(Number(sale.price)).toBe(15);
    expect(sale.machineId).toBe("m-1");
    expect(sale.tenantId).toBe("t-1");

    const movement = tx.inventoryMovement.create.mock.calls[0][0].data;
    expect(movement.type).toBe("sale");
    expect(movement.quantity).toBe(-1);

    // Slot.quantity is the authoritative stock column (see updateSlotService
    // in slots.service.ts) — the InventoryMovement row above only mirrors it.
    // Without this, a machine could sell down to empty while the column, the
    // low-stock alert and the machine-level total never move.
    expect(tx.slot.updateMany).toHaveBeenCalledTimes(1);
    const slotUpdate = tx.slot.updateMany.mock.calls[0][0];
    // Never below 0: the filter keeps an already-empty slot where it is.
    expect(slotUpdate.where).toEqual({ id: "slot-1", quantity: { gt: 0 } });
    expect(slotUpdate.data).toEqual({ quantity: { decrement: 1 } });
  });

  it("keeps a fractional price exact rather than losing cents to float division", async () => {
    const { tx, db } = fakeDb();
    const event = completedEvent() as unknown as { payload: Record<string, unknown> };
    event.payload.price_minor = 1599;

    const [error] = await recordDeviceEventService(db, machine, event as never);

    expect(error).toBeNull();
    const sale = tx.sale.create.mock.calls[0][0].data;
    expect(sale.price.toString()).toBe("15.99");
  });

  it("records a failed vend without touching stock", async () => {
    const { tx, db } = fakeDb();
    const event = completedEvent() as unknown as { payload: Record<string, unknown> };
    event.payload.status = "failed";
    event.payload.received_minor = 1500;
    event.payload.reason = "motor_nak";

    const [error] = await recordDeviceEventService(db, machine, event as never);

    expect(error).toBeNull();
    expect(tx.sale.create.mock.calls[0][0].data.status).toBe("failed");

    // The comment on inventory_movement_type says "motor ran, nothing dropped":
    // the product was not sold, so stock must not move, but the slot's history
    // must show it so a repeatedly failing slot becomes visible.
    const movement = tx.inventoryMovement.create.mock.calls[0][0].data;
    expect(movement.type).toBe("dispense_failure");
    expect(movement.quantity).toBe(0);

    // A failed vend must leave the real stock column alone — nothing left the
    // slot, so nothing here may decrement it.
    expect(tx.slot.updateMany).not.toHaveBeenCalled();
  });

  it("does not throw when the slot cannot be found for a completed sale", async () => {
    const { tx, db } = fakeDb();
    tx.slot.findFirst.mockResolvedValueOnce(null);

    const [error] = await recordDeviceEventService(db, machine, completedEvent());

    expect(error).toBeNull();
    expect(tx.sale.create).toHaveBeenCalledTimes(1);
    expect(tx.slot.updateMany).not.toHaveBeenCalled();
  });

  it("answers a replayed eventId without creating a second Sale", async () => {
    const { tx, db } = fakeDb();
    const duplicate = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["eventId"] },
    });
    tx.machineEvent.create.mockRejectedValueOnce(duplicate);

    const [error, result] = await recordDeviceEventService(db, machine, completedEvent());

    // The device retries until it gets a 2xx. If a replay were an error, the
    // queue would jam forever behind one already-booked sale.
    expect(error).toBeNull();
    expect(result).toMatchObject({ duplicate: true });
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  // The shape Prisma 7 actually throws through @prisma/adapter-pg: no
  // meta.target, the constraint sits under meta.driverAdapterError instead
  // (adapter-pg maps Postgres 23505 to { index: error.constraint }). Found on
  // the bench: one sale whose 201 the device never saw was answered 500 on
  // every retry, and every later sale queued behind it.
  it("answers a replayed eventId as a duplicate when the error comes from the pg driver adapter", async () => {
    const { tx, db } = fakeDb();
    const duplicate = Object.assign(new Error("Unique constraint failed on the constraint: `machine_events_eventId_key`"), {
      code: "P2002",
      meta: {
        modelName: "MachineEvent",
        driverAdapterError: {
          cause: { kind: "UniqueConstraintViolation", constraint: { index: "machine_events_eventId_key" } },
        },
      },
    });
    tx.machineEvent.create.mockRejectedValueOnce(duplicate);

    const [error, result] = await recordDeviceEventService(db, machine, completedEvent());

    expect(error).toBeNull();
    expect(result).toMatchObject({ duplicate: true });
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it("still fails on a unique violation of some other index", async () => {
    const { tx, db } = fakeDb();
    const other = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: { kind: "UniqueConstraintViolation", constraint: { index: "machine_events_other_key" } },
        },
      },
    });
    tx.machineEvent.create.mockRejectedValueOnce(other);

    const [error] = await recordDeviceEventService(db, machine, completedEvent());

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });

  // A late sale from before the slot's last count is already reflected in the
  // counted number, so it is booked as a sale but does not lower the stock.
  it("does not decrement for a sale from before the slot's last count", async () => {
    const { tx, db } = fakeDb();
    tx.inventoryMovement.findFirst.mockResolvedValueOnce({ occurredAt: new Date("2026-09-21T14:00:00Z") });

    const [error] = await recordDeviceEventService(db, machine, completedEvent()); // occurredAt 13:04:11

    expect(error).toBeNull();
    expect(tx.sale.create).toHaveBeenCalledTimes(1);
    expect(tx.slot.updateMany).not.toHaveBeenCalled();
    const where = tx.inventoryMovement.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ slotId: "slot-1", type: { in: ["restock", "correction"] } });
  });

  it("does not decrement a sale at exactly the count time", async () => {
    const { tx, db } = fakeDb();
    tx.inventoryMovement.findFirst.mockResolvedValueOnce({ occurredAt: new Date("2026-09-21T13:04:11Z") });

    await recordDeviceEventService(db, machine, completedEvent());

    expect(tx.slot.updateMany).not.toHaveBeenCalled();
  });

  it("decrements for a sale after the slot's last count", async () => {
    const { tx, db } = fakeDb();
    tx.inventoryMovement.findFirst.mockResolvedValueOnce({ occurredAt: new Date("2026-09-21T12:00:00Z") });

    await recordDeviceEventService(db, machine, completedEvent());

    expect(tx.slot.updateMany).toHaveBeenCalledTimes(1);
  });

  // Without a clock the device sends uptimeMs and the time is only an
  // estimate (about the boot time). The machine always subtracts such a sale,
  // so the backend must always decrement it too, or the two disagree by one.
  it("always decrements a sale without a real timestamp, whatever the count time", async () => {
    const { tx, db } = fakeDb();
    tx.inventoryMovement.findFirst.mockResolvedValue({ occurredAt: new Date(Date.now() + 60_000) });
    const event = completedEvent() as unknown as Record<string, unknown>;
    delete event.occurredAt;
    event.uptimeMs = 3_600_000;

    await recordDeviceEventService(db, machine, event as never);

    expect(tx.slot.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects a cash sale without a ledger", async () => {
    const { tx, db } = fakeDb();
    const bad = completedEvent() as unknown as { payload: Record<string, unknown> };
    delete bad.payload.ledger;

    const [error] = await recordDeviceEventService(db, machine, bad as never);

    expect(error?.reason).toBe("CASH_SALE_PAYLOAD_INVALID");
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it("rejects a payload that is not a cash sale shape", async () => {
    const { tx, db } = fakeDb();
    const bad = completedEvent() as unknown as { payload: Record<string, unknown> };
    bad.payload.price_minor = -1;

    const [error] = await recordDeviceEventService(db, machine, bad as never);

    expect(error).not.toBeNull();
    // Distinct from UNKNOWN_ERROR (which the controller maps to 500, and the
    // device would retry forever): a payload that will never parse must be
    // answered with a 4xx so drain_outbox_once actually drops the line
    // (spec 8.4).
    expect(error?.reason).toBe("CASH_SALE_PAYLOAD_INVALID");
    expect(tx.sale.create).not.toHaveBeenCalled();
  });
});

/**
 * `occurredAt` resolution is the crux of Step 1a: an ESP32 with no
 * battery-backed RTC sends `uptimeMs` instead, and the server has to date the
 * sale from receipt minus that elapsed time. None of the tests above exercise
 * this, since they all set `occurredAt` explicitly.
 */
describe("recordDeviceEventService, clock-less devices", () => {
  it("dates the sale from receipt minus uptimeMs when occurredAt is absent", async () => {
    const { tx, db } = fakeDb();
    const before = Date.now();
    const event = {
      type: "cash_sale",
      eventId: "VM-16FEE909-000413",
      sequenceNumber: 413,
      uptimeMs: 734512,
      payload: {
        slot: 12,
        price_minor: 1500,
        received_minor: 2000,
        status: "completed",
        currency: "DKK",
        ledger: "k3f9x2a1",
      },
    } as never;

    const [error] = await recordDeviceEventService(db, machine, event);

    expect(error).toBeNull();
    const eventOccurredAt = tx.machineEvent.create.mock.calls[0][0].data.occurredAt as Date;
    const expected = before - 734512;
    // Wall-clock arithmetic, not a mocked clock: allow a small window for the
    // test's own execution time either side of `before`/`after`.
    expect(eventOccurredAt.getTime()).toBeGreaterThanOrEqual(expected - 50);
    expect(eventOccurredAt.getTime()).toBeLessThanOrEqual(Date.now() - 734512 + 50);

    // The same resolved value must be used for the Sale and the movement, not
    // re-derived — otherwise two rows for one coin could disagree on when it
    // dropped.
    const sale = tx.sale.create.mock.calls[0][0].data;
    expect(sale.completedAt.getTime()).toBe(eventOccurredAt.getTime());
    const movement = tx.inventoryMovement.create.mock.calls[0][0].data;
    expect(movement.occurredAt.getTime()).toBe(eventOccurredAt.getTime());
  });

  it("prefers an explicit occurredAt over uptimeMs when both are present", async () => {
    const { tx, db } = fakeDb();
    const event = {
      type: "cash_sale",
      eventId: "VM-16FEE909-000414",
      sequenceNumber: 414,
      occurredAt: "2020-01-01T00:00:00Z",
      // Wildly different from the explicit timestamp — if this won, the
      // assertion below would fail.
      uptimeMs: 734512,
      payload: {
        slot: 12,
        price_minor: 1500,
        received_minor: 2000,
        status: "completed",
        currency: "DKK",
        ledger: "k3f9x2a1",
      },
    } as never;

    const [error] = await recordDeviceEventService(db, machine, event);

    expect(error).toBeNull();
    const eventOccurredAt = tx.machineEvent.create.mock.calls[0][0].data.occurredAt as Date;
    expect(eventOccurredAt.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });
});
