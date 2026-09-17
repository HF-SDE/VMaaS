import { type Prisma, type Slot, inventory_movement_type } from "@/generated/prisma/client";
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

async function tenantOwnsProduct(tx: Prisma.TransactionClient, tenantId: string, productId: string): Promise<boolean> {
  return (await tx.product.count({ where: { id: productId, tenantId } })) > 0;
}

class SlotWriteRejected extends Error {
  constructor(readonly failure: SlotNotFoundError | SlotProductNotFoundError | SlotOverfilledError) {
    super(failure.message);
  }
}

function unknownError(action: string, cause: unknown): Result<UnknownSlotError, never> {
  console.error(`[slots.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the slot.`,
  });
}

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
  userId: string,
): Promise<
  Result<SlotNotFoundError | SlotProductNotFoundError | SlotOverfilledError | UnknownSlotError, SlotListItem>
> {
  try {
    return ok(
      await prisma.$transaction(async (tx) => {
        const slot = await tx.slot.findFirst({
          where: { id, machine: { tenantId } },
          select: { quantity: true, capacity: true },
        });

        if (!slot) throw new SlotWriteRejected(SLOT_NOT_FOUND);

        if ((data.quantity ?? slot.quantity) > (data.capacity ?? slot.capacity)) {
          throw new SlotWriteRejected(SLOT_OVERFILLED);
        }

        if (data.productId !== undefined && !(await tenantOwnsProduct(tx, tenantId, data.productId))) {
          throw new SlotWriteRejected(PRODUCT_NOT_FOUND);
        }
        const updated = await tx.slot.update({ where: { id }, data, include: { product: PRODUCT_SELECT } });
        const delta = updated.quantity - slot.quantity;

        if (delta !== 0) {
          await tx.inventoryMovement.create({
            data: {
              tenantId,
              slotId: id,
              userId,
              type: inventory_movement_type.correction,
              quantity: delta,
              note: "Slot edited in the admin",
            },
          });
        }

        return updated;
      }),
    );
  } catch (error) {
    if (error instanceof SlotWriteRejected) return err(error.failure);

    return unknownError("updating", error);
  }
}
