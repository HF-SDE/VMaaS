import type { Slot } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { SlotProduct, SlotWriteData } from "@vmaas/shared/types/slot";

export type SlotNotFoundError = { reason: "SLOT_NOT_FOUND"; message: string };
/** A read named a machine that is not this tenant's — or does not exist at all. */
export type SlotMachineNotFoundError = { reason: "MACHINE_NOT_FOUND"; message: string };
/** A write named a product that is not this tenant's — or does not exist at all. */
export type SlotProductNotFoundError = { reason: "PRODUCT_NOT_FOUND"; message: string };
export type SlotOverfilledError = { reason: "SLOT_OVERFILLED"; message: string };
export type UnknownSlotError = { reason: "UNKNOWN_ERROR"; message: string };

/** A slot row with the product loaded in it, as every read returns it. */
export type SlotListItem = Slot & { product: SlotProduct };

/** What `SlotProduct` carries — enough to name the product and link to it. */
const PRODUCT_SELECT = { select: { id: true, name: true } } as const;

const SLOT_NOT_FOUND: SlotNotFoundError = {
  reason: "SLOT_NOT_FOUND",
  message: "The slot does not exist.",
};

const MACHINE_NOT_FOUND: SlotMachineNotFoundError = {
  reason: "MACHINE_NOT_FOUND",
  message: "The machine does not exist.",
};

const PRODUCT_NOT_FOUND: SlotProductNotFoundError = {
  reason: "PRODUCT_NOT_FOUND",
  message: "The product does not exist.",
};

const SLOT_OVERFILLED: SlotOverfilledError = {
  reason: "SLOT_OVERFILLED",
  message: "The quantity does not fit the capacity.",
};

/**
 * Whether the tenant owns the product a write named.
 *
 * `productId` is the one field on a slot that points at another row the caller
 * chose, so it is the one field that could reach across tenants — the same
 * reasoning as `tenantOwnsSite` in the machines service.
 */
async function tenantOwnsProduct(tenantId: string, productId: string): Promise<boolean> {
  return (await prisma.product.count({ where: { id: productId, tenantId } })) > 0;
}

function unknownError(action: string, cause: unknown): Result<UnknownSlotError, never> {
  console.error(`[slots.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the slot.`,
  });
}

/**
 * Every slot cut into one machine, in slot-number order.
 *
 * Not paginated: a machine holds a few dozen slots at most, and the table that
 * reads this sorts and filters them in the browser. There is no page to clamp
 * and no count to run.
 *
 * A `Slot` carries no `tenantId` of its own — it hangs off the machine — so the
 * machine is what the tenant is checked against. That check is its own query
 * rather than a filter on the slots: a machine of another tenant would otherwise
 * answer an empty table, which reads as "no slots yet" instead of "not yours".
 */
export async function getMachineSlotsService(
  tenantId: string,
  machineId: string,
): Promise<Result<SlotMachineNotFoundError | UnknownSlotError, SlotListItem[]>> {
  try {
    if ((await prisma.machine.count({ where: { id: machineId, tenantId } })) === 0) return err(MACHINE_NOT_FOUND);

    return ok(
      await prisma.slot.findMany({
        where: { machineId },
        include: { product: PRODUCT_SELECT },
        orderBy: { slotNumber: "asc" },
      }),
    );
  } catch (error) {
    return unknownError("listing", error);
  }
}

export async function updateSlotService(
  tenantId: string,
  id: string,
  data: SlotWriteData,
): Promise<
  Result<SlotNotFoundError | SlotProductNotFoundError | SlotOverfilledError | UnknownSlotError, SlotListItem>
> {
  try {
    // Scoped through the machine, as the list above is: the relation is what
    // keeps one tenant out of another's slots.
    const slot = await prisma.slot.findFirst({
      where: { id, machine: { tenantId } },
      select: { quantity: true, capacity: true },
    });

    if (!slot) return err(SLOT_NOT_FOUND);

    // Both halves as they will stand after the write, not only the one that
    // changed: raising the quantity and lowering the capacity in one request has
    // to be judged together, and either alone can break the pair.
    if ((data.quantity ?? slot.quantity) > (data.capacity ?? slot.capacity)) return err(SLOT_OVERFILLED);

    // Only when the write moves the slot to another product: an update that just
    // restocks it should not pay for a lookup, and has no product to vouch for.
    if (data.productId !== undefined && !(await tenantOwnsProduct(tenantId, data.productId))) {
      return err(PRODUCT_NOT_FOUND);
    }

    // A plain `update` is safe here where the machines service needs
    // `updateMany`: the `findFirst` above already matched this id against the
    // tenant, so the row is known to be theirs.
    return ok(await prisma.slot.update({ where: { id }, data, include: { product: PRODUCT_SELECT } }));
  } catch (error) {
    return unknownError("updating", error);
  }
}
