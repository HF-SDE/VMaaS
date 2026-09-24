import { STEPS_PER_VEND_MAX, STEPS_PER_VEND_MIN } from "@vmaas/shared/lib/gpio";

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
 *
 * `wiring.motor` carries the machine's `stepsPerVend`, which the device's
 * parser requires; a change to it is therefore wiring drift.
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

/** Motorcontrol's `motor` block: the STEP pulse count every vend on this machine emits. */
export type WiringMotor = { stepsPerVend: number };

export type ConfigurationPayload = {
  cash: Record<string, unknown>;
  prices: { slot: number; priceMinor: number }[];
  wiring: { version: typeof WIRING_SCHEMA_VERSION; motor: WiringMotor; slots: WiringSlot[] };
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

export function buildConfigurationPayload(
  slots: PayloadSlot[],
  cash: Record<string, unknown>,
  motor: WiringMotor,
): ConfigurationPayload {
  if (
    !Number.isInteger(motor.stepsPerVend) ||
    motor.stepsPerVend < STEPS_PER_VEND_MIN ||
    motor.stepsPerVend > STEPS_PER_VEND_MAX
  ) {
    throw new Error(
      `stepsPerVend must be an integer ${STEPS_PER_VEND_MIN}-${STEPS_PER_VEND_MAX}, got ${String(motor.stepsPerVend)}`,
    );
  }

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
      motor: { stepsPerVend: motor.stepsPerVend },
      slots: ordered.map((slot) => ({
        slot: slot.slotNumber,
        pins: slot.pins.map((pin) => pin.number).sort((a, b) => a - b),
      })),
    },
  };
}

/**
 * JSON with every object's keys sorted, recursively. Postgres jsonb stores keys
 * by length then bytewise, so a payload read back from `machine_configurations`
 * never has the builder's key order; comparing the raw JSON text would report
 * drift on every load. Arrays keep their order: slot and pin order IS content.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

/**
 * What differs between the machine's current rows and what was last published.
 *
 * The two blocks are compared separately because they move for different
 * reasons: `prices` changes when a tenant edits a slot price in their own UI,
 * while `wiring` changes only in the layout editor. Reporting one boolean would
 * make a price edit look like an unpublished rewiring.
 *
 * Compared on canonical JSON (keys sorted recursively), not the raw JSON text:
 * jsonb does not preserve key order, so a payload read back from the database
 * never matches the builder's key order byte for byte even when nothing
 * changed. Array order is still significant — a slot's pins and the slot list
 * itself are compared in the order they appear. `prices` never showed this bug
 * only because jsonb's length-then-bytewise key order (`slot` before
 * `priceMinor`) happens to already match the builder's, so nobody should "fix"
 * prices separately from wiring.
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
    wiring: stored.wiring === undefined || canonicalJson(current.wiring) !== canonicalJson(stored.wiring),
    prices: stored.prices === undefined || canonicalJson(current.prices) !== canonicalJson(stored.prices),
  };
}
