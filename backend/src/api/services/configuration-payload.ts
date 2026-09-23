/**
 * Builds the JSON a machine fetches from `GET /api/device/configuration`.
 *
 * The shape is not ours to choose: `Main-Controller/src/prices.cpp` already
 * parses it out of `/storage/prices.json`, which its own header describes as
 * "a cache of MachineConfiguration.payload". `wiring` is shaped as
 * Motorcontrol's own config.json so Main-Controller forwards it without
 * translating between two schemas.
 *
 * Pure on purpose: the payload is the contract with two firmwares, and a
 * function over plain rows can be tested exhaustively without a database.
 */

/** Motorcontrol's slot table schema version. v1's scalar `pin` is gone. */
export const WIRING_SCHEMA_VERSION = 2;

export type PayloadSlot = {
  slotNumber: number;
  price: number | null;
  product: { price: number } | null;
  pins: { number: number }[];
};

export type WiringSlot = { slot: number; pins: number[] };

export type ConfigurationPayload = {
  cash: Record<string, unknown>;
  prices: { slot: number; priceMinor: number }[];
  wiring: { version: typeof WIRING_SCHEMA_VERSION; slots: WiringSlot[] };
};

/** Major units to minor, as the firmware counts coins in minor units. */
function toMinor(major: number): number {
  return Math.round(major * 100);
}

/**
 * @returns The slot numbers with no pins. Publishing is refused while this is
 *          non-empty: a half-finished wiring must not reach hardware.
 */
export function findUnwiredSlots(slots: PayloadSlot[]): number[] {
  return slots.filter((slot) => slot.pins.length === 0).map((slot) => slot.slotNumber);
}

/** A Prisma row as this module sees it: Decimals are `unknown` until converted. */
type PayloadSlotRow = {
  slotNumber: number;
  price: unknown;
  product: { price: unknown } | null;
  pins: { number: number }[];
};

/**
 * Prisma rows to the plain shape the builder takes.
 *
 * `Number(null)` is 0 and 0 is a legitimate price, so a null price is
 * preserved rather than converted — that null is what makes the builder fall
 * back to the product's price instead of selling a free item.
 */
export function toPayloadSlots(rows: PayloadSlotRow[]): PayloadSlot[] {
  return rows.map((row) => ({
    slotNumber: row.slotNumber,
    price: row.price === null ? null : Number(row.price),
    product: row.product ? { price: Number(row.product.price) } : null,
    pins: row.pins,
  }));
}

export function buildConfigurationPayload(slots: PayloadSlot[], cash: Record<string, unknown>): ConfigurationPayload {
  const ordered = [...slots].sort((a, b) => a.slotNumber - b.slotNumber);

  return {
    cash,
    prices: ordered.flatMap((slot) => {
      const major = slot.price ?? slot.product?.price ?? null;
      if (major === null) return [];
      return [{ slot: slot.slotNumber, priceMinor: toMinor(major) }];
    }),
    wiring: {
      version: WIRING_SCHEMA_VERSION,
      slots: ordered.map((slot) => ({
        slot: slot.slotNumber,
        pins: slot.pins.map((pin) => pin.number).sort((a, b) => a - b),
      })),
    },
  };
}

/**
 * What differs between the machine's current rows and what was last published.
 *
 * The two blocks are compared separately because they move for different
 * reasons: `prices` changes when a tenant edits a slot price in their own UI,
 * while `wiring` changes only in the layout editor. Reporting one boolean would
 * make a price edit look like an unpublished rewiring.
 *
 * Compared as JSON rather than field by field: both sides are produced by
 * `buildConfigurationPayload`, which orders slots and pins deterministically,
 * so equal content serialises identically.
 *
 * @returns `true` for a block that DIFFERS.
 */
export function comparePayloads(
  current: ConfigurationPayload,
  published: unknown,
): { wiring: boolean; prices: boolean } {
  const stored = published as Partial<ConfigurationPayload> | null;

  if (stored === null || typeof stored !== "object") {
    return { wiring: true, prices: true };
  }

  return {
    wiring: JSON.stringify(current.wiring) !== JSON.stringify(stored.wiring),
    prices: JSON.stringify(current.prices) !== JSON.stringify(stored.prices),
  };
}
