import { describe, expect, it } from "vitest";

import {
  buildConfigurationPayload,
  comparePayloads,
  findUnwiredSlots,
  toPayloadSlots,
} from "@/api/services/configuration-payload";

const CASH = { activeLow: true, currency: "DKK" };
const MOTOR = { stepsPerVend: 6400 };

function slot(overrides: Record<string, unknown> = {}) {
  return { slotNumber: 1, price: null, product: null, pins: [{ number: 18 }], ...overrides } as never;
}

describe("buildConfigurationPayload", () => {
  // The firmware's slot_config_parser reads this shape; prices.cpp reads the rest.
  it("shapes wiring as Motorcontrol's own config.json v2: version, motor, slots", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, pins: [{ number: 21 }, { number: 22 }] })],
      CASH,
      { stepsPerVend: 3200 },
    );

    expect(payload.wiring).toEqual({ version: 2, motor: { stepsPerVend: 3200 }, slots: [{ slot: 3, pins: [21, 22] }] });
  });

  // Making the column 1-based was the whole point; a conversion here would be a bug.
  it("passes slot numbers through untouched", () => {
    const payload = buildConfigurationPayload([slot({ slotNumber: 7, price: 15 })], CASH, MOTOR);

    expect(payload.wiring.slots[0].slot).toBe(7);
    expect(payload.prices[0].slot).toBe(7);
  });

  it("prefers the slot's price override over the product's", () => {
    const payload = buildConfigurationPayload([slot({ price: 12.5, product: { price: 15 } })], CASH, MOTOR);

    expect(payload.prices[0].priceMinor).toBe(1250);
  });

  it("falls back to the product's price when the slot does not override it", () => {
    const payload = buildConfigurationPayload([slot({ price: null, product: { price: 15 } })], CASH, MOTOR);

    expect(payload.prices[0].priceMinor).toBe(1500);
  });

  // prices.h: "0 means no price, not for sale".
  it("omits a slot with no price at all rather than pricing it at zero", () => {
    const payload = buildConfigurationPayload([slot({ price: null, product: null })], CASH, MOTOR);

    expect(payload.prices).toEqual([]);
  });

  it("orders wiring and prices by slot number, so a diff between versions is readable", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, price: 10, pins: [{ number: 21 }] }), slot({ slotNumber: 1, price: 5, pins: [{ number: 18 }] })],
      CASH,
      MOTOR,
    );

    expect(payload.wiring.slots.map((entry) => entry.slot)).toEqual([1, 3]);
    expect(payload.prices.map((entry) => entry.slot)).toEqual([1, 3]);
  });

  // Dropping the .sort() on pins would go unnoticed without this test.
  it("sorts pins in ascending order to catch accidental removals of the sort", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 2, price: 10, pins: [{ number: 22 }, { number: 18 }, { number: 21 }] })],
      CASH,
      MOTOR,
    );

    expect(payload.wiring.slots[0].pins).toEqual([18, 21, 22]);
  });

  // Regressing ?? to || would silently drop free items (price: 0), with no test catching it.
  it("includes slots priced at zero, not omitted as 'no price'", () => {
    const payload = buildConfigurationPayload([slot({ slotNumber: 1, price: 0 })], CASH, MOTOR);

    expect(payload.prices).toEqual([{ slot: 1, priceMinor: 0 }]);
  });

  // Dropping the sort on prices would go unnoticed without this test.
  it("orders prices by slot number for readable diffs", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, price: 30 }), slot({ slotNumber: 1, price: 10 }), slot({ slotNumber: 2, price: 20 })],
      CASH,
      MOTOR,
    );

    expect(payload.prices.map((entry) => entry.slot)).toEqual([1, 2, 3]);
  });

  // A select that forgot stepsPerVend yields undefined; JSON drops the key and
  // the device answers MissingField. Better to fail the publish than to ship it.
  it("refuses a missing or out-of-range stepsPerVend", () => {
    expect(() => buildConfigurationPayload([slot()], CASH, { stepsPerVend: undefined as never })).toThrow(/stepsPerVend/);
    expect(() => buildConfigurationPayload([slot()], CASH, { stepsPerVend: 0 })).toThrow(/stepsPerVend/);
    expect(() => buildConfigurationPayload([slot()], CASH, { stepsPerVend: 65536 })).toThrow(/stepsPerVend/);
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

  const withMotor = (stepsPerVend: number) => ({
    cash: {},
    prices: [{ slot: 1, priceMinor: 1500 }],
    wiring: { version: 2, motor: { stepsPerVend }, slots: [{ slot: 1, pins: [18] }] },
  });

  // stepsPerVend rides inside wiring, so changing it is a wiring drift: the
  // device has to be re-published before the new pulse count takes effect.
  it("reports a stepsPerVend change as wiring drift", () => {
    expect(comparePayloads(withMotor(3200) as never, withMotor(6400))).toEqual({ wiring: true, prices: false });
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

  // What Postgres jsonb actually hands back: keys sorted by length, then bytewise.
  const asStoredByJsonb = (stepsPerVend: number, pins: number[]) => ({
    cash: {},
    prices: [{ slot: 1, priceMinor: 1500 }],
    wiring: { motor: { stepsPerVend }, slots: [{ pins, slot: 1 }], version: 2 },
  });

  it("ignores the key order jsonb imposes on a stored payload", () => {
    expect(comparePayloads(withMotor(6400) as never, asStoredByJsonb(6400, [18]))).toEqual({
      wiring: false,
      prices: false,
    });
  });

  it("still sees a real change through the reordered keys", () => {
    expect(comparePayloads(withMotor(6400) as never, asStoredByJsonb(3200, [18]))).toEqual({
      wiring: true,
      prices: false,
    });
    expect(comparePayloads(withMotor(6400) as never, asStoredByJsonb(6400, [19]))).toEqual({
      wiring: true,
      prices: false,
    });
  });

  // A stored payload from before wiring existed has no such block: that is drift.
  it("treats a stored payload with no wiring block as wiring drift", () => {
    expect(comparePayloads(withMotor(6400) as never, { cash: {}, prices: [{ slot: 1, priceMinor: 1500 }] })).toEqual({
      wiring: true,
      prices: false,
    });
  });

  // Arrays are content: two slots swapped is a different wiring, not a reordering.
  it("does not treat a reordered slots array as equal", () => {
    const current = {
      cash: {},
      prices: [],
      wiring: { version: 2, motor: { stepsPerVend: 6400 }, slots: [{ slot: 1, pins: [18] }, { slot: 2, pins: [19] }] },
    };
    const stored = {
      cash: {},
      prices: [],
      wiring: { version: 2, motor: { stepsPerVend: 6400 }, slots: [{ slot: 2, pins: [19] }, { slot: 1, pins: [18] }] },
    };
    expect(comparePayloads(current as never, stored).wiring).toBe(true);
  });
});
