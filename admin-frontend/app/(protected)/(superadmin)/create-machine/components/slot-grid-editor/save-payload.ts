import type { SaveSlotLayoutData } from "@vmaas/shared/types/machine"

import type { Layout } from "./types"

/** The body of `POST /api/machines/save-slot-layout`; the type and its rules live in the shared folder */
export function createSavePayload(
  machineId: string,
  layout: Layout
): SaveSlotLayoutData {
  return {
    machineId,
    columns: layout.columns,
    rows: layout.rows,
    // Only the fields that describe the layout; editor-only fields like `key` stay out
    slots: layout.slots.map((slot) => ({
      id: slot.id,
      slotNumber: slot.slotNumber,
      beginX: slot.beginX,
      endX: slot.endX,
      beginY: slot.beginY,
      endY: slot.endY,
      capacity: slot.capacity,
    })),
  }
}
