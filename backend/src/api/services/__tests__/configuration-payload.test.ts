import { describe, expect, it } from "vitest";

import {
  buildConfigurationPayload,
  comparePayloads,
  findUnwiredSlots,
  toPayloadSlots,
} from "@/api/services/configuration-payload";

const CASH = { activeLow: true, currency: "DKK" };

function slot(overrides: Record<string, unknown> = {}) {
  return { slotNumber: 1, price: null, product: null, pins: [{ number: 18 }], ...overrides } as never;
}

describe("buildConfigurationPayload", () => {
  // The firmware's slot_config_parser reads this shape; prices.cpp reads the rest.
  it("shapes wiring as Motorcontrol's own config.json, at schema version 2", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, pins: [{ number: 21 }, { number: 22 }] })],
      CASH,
    );

    expect(payload.wiring).toEqual({ version: 2, slots: [{ slot: 3, pins: [21, 22] }] });
  });

  // Making the column 1-based was the whole point; a conversion here would be a bug.
  it("passes slot numbers through untouched", () => {
    const payload = buildConfigurationPayload([slot({ slotNumber: 7, price: 15 })], CASH);

    expect(payload.wiring.slots[0].slot).toBe(7);
    expect(payload.prices[0].slot).toBe(7);
  });

  it("prefers the slot's price override over the product's", () => {
    const payload = buildConfigurationPayload([slot({ price: 12.5, product: { price: 15 } })], CASH);

    expect(payload.prices[0].priceMinor).toBe(1250);
  });

  it("falls back to the product's price when the slot does not override it", () => {
    const payload = buildConfigurationPayload([slot({ price: null, product: { price: 15 } })], CASH);

    expect(payload.prices[0].priceMinor).toBe(1500);
  });

  // prices.h: "0 means no price, not for sale".
  it("omits a slot with no price at all rather than pricing it at zero", () => {
    const payload = buildConfigurationPayload([slot({ price: null, product: null })], CASH);

    expect(payload.prices).toEqual([]);
  });

  it("orders wiring and prices by slot number, so a diff between versions is readable", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, price: 10, pins: [{ number: 21 }] }), slot({ slotNumber: 1, price: 5, pins: [{ number: 18 }] })],
      CASH,
    );

    expect(payload.wiring.slots.map((entry) => entry.slot)).toEqual([1, 3]);
    expect(payload.prices.map((entry) => entry.slot)).toEqual([1, 3]);
  });

  // Dropping the .sort() on pins would go unnoticed without this test.
  it("sorts pins in ascending order to catch accidental removals of the sort", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 2, price: 10, pins: [{ number: 22 }, { number: 18 }, { number: 21 }] })],
      CASH,
    );

    expect(payload.wiring.slots[0].pins).toEqual([18, 21, 22]);
  });

  // Regressing ?? to || would silently drop free items (price: 0), with no test catching it.
  it("includes slots priced at zero, not omitted as 'no price'", () => {
    const payload = buildConfigurationPayload([slot({ slotNumber: 1, price: 0 })], CASH);

    expect(payload.prices).toEqual([{ slot: 1, priceMinor: 0 }]);
  });

  // Dropping the sort on prices would go unnoticed without this test.
  it("orders prices by slot number for readable diffs", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, price: 30 }), slot({ slotNumber: 1, price: 10 }), slot({ slotNumber: 2, price: 20 })],
      CASH,
    );

    expect(payload.prices.map((entry) => entry.slot)).toEqual([1, 2, 3]);
  });
});

describe("findUnwiredSlots", () => {
  it("names the slots with no pins", () => {
    expect(findUnwiredSlots([slot({ slotNumber: 2, pins: [] }), slot({ slotNumber: 1 })])).toEqual([2]);
  });

  it("returns nothing when every slot is wired", () => {
    expect(findUnwiredSlots([slot()])).toEqual([]);
  });
});

describe("toPayloadSlots", () => {
  // Prisma hands back Decimal objects; the payload builder is deliberately
  // Prisma-free and works in plain numbers, so the conversion lives here.
  it("converts Decimal-like prices to numbers", () => {
    const rows = [{ slotNumber: 1, price: "12.50", product: { price: "15.00" }, pins: [{ number: 18 }] }];

    expect(toPayloadSlots(rows as never)).toEqual([
      { slotNumber: 1, price: 12.5, product: { price: 15 }, pins: [{ number: 18 }] },
    ]);
  });

  // Number(null) is 0, and 0 is a legitimate price — a free item. Preserving
  // null is what lets the payload builder fall back to the product's price.
  it("preserves a null slot price as null, not 0", () => {
    const rows = [{ slotNumber: 1, price: null, product: { price: "15.00" }, pins: [] }];

    expect(toPayloadSlots(rows as never)[0].price).toBeNull();
  });

  it("preserves an absent product as null", () => {
    const rows = [{ slotNumber: 1, price: "5.00", product: null, pins: [] }];

    expect(toPayloadSlots(rows as never)[0].product).toBeNull();
  });
});

describe("comparePayloads", () => {
  const payload = (wiringPins: number[], priceMinor: number) => ({
    cash: {},
    prices: [{ slot: 1, priceMinor }],
    wiring: { version: 2, slots: [{ slot: 1, pins: wiringPins }] },
  });

  it("reports no difference when both blocks match", () => {
    expect(comparePayloads(payload([18], 1500) as never, payload([18], 1500))).toEqual({
      wiring: false,
      prices: false,
    });
  });

  // The two blocks move for different reasons: prices change when a tenant
  // edits one in their own UI, wiring only changes in the layout editor.
  it("reports a wiring difference alone", () => {
    expect(comparePayloads(payload([19], 1500) as never, payload([18], 1500))).toEqual({
      wiring: true,
      prices: false,
    });
  });

  it("reports a price difference alone", () => {
    expect(comparePayloads(payload([18], 1600) as never, payload([18], 1500))).toEqual({
      wiring: false,
      prices: true,
    });
  });

  // A published payload from an older shape, or a hand-edited row, must not
  // throw — it simply differs.
  it("treats an unrecognisable published payload as differing in both", () => {
    expect(comparePayloads(payload([18], 1500) as never, null)).toEqual({ wiring: true, prices: true });
  });
});
