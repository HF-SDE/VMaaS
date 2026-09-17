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
