/**
 * What `GET /api/slots` takes.
 *
 * `machineId` is required: a slot only means anything next to the machine it is
 * cut into, so there is no tenant-wide list of slots to answer.
 */
export interface GetSlotsParams {
  machineId: string;
}

/** The product in a slot, as every slot read includes it — enough to name it and
 *  link to it. The price is deliberately absent: the slot carries its own. */
export interface SlotProduct {
  id: string;
  name: string;
}

/**
 * The columns a slot write accepts.
 *
 * `machineId`, `slotNumber` and the `beginX`/`endX`/`beginY`/`endY` box are all
 * absent: they describe where the slot physically is inside the machine, which
 * is the firmware's business and not something an admin retypes.
 *
 * `price` takes `null`, unlike the rest — the column is nullable, and clearing
 * it is how a slot stops overriding what the product costs.
 */
export interface SlotWriteData {
  productId?: string;
  quantity?: number;
  capacity?: number;
  price?: number | null;
}

/**
 * A slot at or below this share of its capacity needs a visit.
 *
 * A ratio rather than a fixed count because capacity varies per slot: three
 * items left in a 40-slot is a problem, three left in a 4-slot is normal. A
 * constant rather than a per-slot column because a `lowStockThreshold` costs a
 * migration, a schema change and a form change for a rule unlikely to be tuned
 * per slot.
 */
export const LOW_STOCK_RATIO = 0.2;

/** The restock queue is a summary card, not the machines list. */
export const LOW_STOCK_LIMIT = 50;

/** One row of the restock queue, flattened for the wire like `MachineAlertRow`. */
export interface LowStockSlot {
  slotId: string;
  slotNumber: number;
  quantity: number;
  capacity: number;
  /** Null when nothing is assigned to the slot. */
  productName: string | null;
  machineId: string;
  machineName: string;
  siteId: string;
  siteName: string;
}
