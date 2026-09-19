import { type Prisma, type Slot, inventory_movement_type } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import {
  LOW_STOCK_LIMIT,
  LOW_STOCK_RATIO,
  type LowStockSlot,
  type SlotProduct,
  type SlotWriteData,
} from "@vmaas/shared/types/slot";

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

/** The columns the restock queue needs, joined down to the names it prints. */
const LOW_STOCK_SELECT = {
  id: true,
  slotNumber: true,
  quantity: true,
  capacity: true,
  product: { select: { name: true } },
  machine: { select: { id: true, name: true, site: { select: { id: true, name: true } } } },
} as const;

export type LowStockCandidate = Prisma.SlotGetPayload<{ select: typeof LOW_STOCK_SELECT }>;

/**
 * The half of the restock queue with no database in it: which slots are low,
 * in what order, and how many of them.
 *
 * The filter is applied here rather than in SQL because `quantity <= capacity *
 * LOW_STOCK_RATIO` compares two columns, which a Prisma `where` cannot express
 * — and doing it in TypeScript makes the rule directly testable, the way
 * `clampAlertPaging` and `buildAlertWhere` are. The caller's query still scopes
 * by tenant and drops zero-capacity rows, so the set that reaches here is small.
 *
 * Exported for its own test.
 */
export function selectLowStockSlots(rows: LowStockCandidate[]): LowStockSlot[] {
  return (
    rows
      .filter((row) => row.capacity > 0 && row.quantity <= row.capacity * LOW_STOCK_RATIO)
      // Emptiest first. An empty slot is selling nothing, which is strictly worse
      // than one running down, and its ratio of 0 already sorts it to the top.
      .sort((a, b) => a.quantity / a.capacity - b.quantity / b.capacity)
      .slice(0, LOW_STOCK_LIMIT)
      .flatMap((row) => {
        const site = row.machine.site;
        if (!site) {
          console.error(`[slots.service] invariant violated: slot ${row.id}'s machine ${row.machine.id} has no site`);
          return [];
        }

        return [
          {
            slotId: row.id,
            slotNumber: row.slotNumber,
            quantity: row.quantity,
            capacity: row.capacity,
            productName: row.product?.name ?? null,
            machineId: row.machine.id,
            machineName: row.machine.name,
            siteId: site.id,
            siteName: site.name,
          },
        ];
      })
  );
}

/**
 * Every slot in the tenant that needs a visit.
 *
 * Deliberately tenant-wide, unlike `GET /api/slots`, which requires a
 * `machineId` on the grounds that a slot only means anything next to its
 * machine. That holds for listing one machine's slots; it does not hold here —
 * the question the restock queue answers is which machines to drive to.
 *
 * `capacity > 0` is excluded in SQL: a zero-capacity slot is a misconfiguration,
 * not an empty slot, and has no place in a restock queue.
 */
export async function getLowStockSlotsService(tenantId: string): Promise<Result<UnknownSlotError, LowStockSlot[]>> {
  try {
    const rows = await prisma.slot.findMany({
      where: { machine: { tenantId }, capacity: { gt: 0 } },
      select: LOW_STOCK_SELECT,
    });

    return ok(selectLowStockSlots(rows));
  } catch (error) {
    // TODO: capture sentry error
    console.error("[slots.service] listing low stock failed", error);

    return err({
      reason: "UNKNOWN_ERROR",
      message: "An unknown error occurred while listing the low stock slots.",
    });
  }
}
