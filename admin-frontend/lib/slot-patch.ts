import type { SlotWriteData } from "@vmaas/shared/types/slot"

type SlotFields = { quantity: number; capacity: number; price: number | null }

/**
 * The PATCH body for a slot edit.
 *
 * `quantity` goes only when the user changed it. The number the dialog loaded
 * can be stale by the time it is saved (a sale was booked meanwhile), and
 * resending it would be recorded as a correction that resets the slot's count
 * time: the machine would then offer an item that is already gone (spec: slot
 * stock). Capacity and price are resent as before; resending an unchanged one
 * is a no-op on the backend.
 */
export function slotPatchBody(
  value: SlotFields,
  loaded: SlotFields,
  productId: string
): SlotWriteData {
  const body: SlotWriteData = {
    capacity: value.capacity,
    price: value.price,
    productId,
  }
  if (value.quantity !== loaded.quantity) body.quantity = value.quantity
  return body
}

/**
 * "Confirm count" confirms the number stored on the backend, so it is offered
 * only while the quantity field still shows that number: a typed, unsaved one
 * would be silently ignored while the user believes it was counted.
 */
export function canConfirmCount(current: number, loaded: number): boolean {
  return current === loaded
}
