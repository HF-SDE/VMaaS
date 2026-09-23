import { useState, type PointerEvent } from "react"

import { NEW_SLOT_CAPACITY } from "../constants"
import { cellAtPoint } from "../grid-placement"
import {
  isFreeSpace,
  moveRect,
  nextSlotNumber,
  rectFromCells,
  rectsEqual,
  resizeRect,
} from "../layout-math"
import type { Edge, EditorSlot, Interaction, Layout, Preview } from "../types"

/**
 * Data attributes that tell the pointer handler what was pressed.
 * Set by <SlotCard>; anything without them counts as empty grid space.
 */
export const SLOT_ATTRIBUTE = "data-slot-key"
export const RESIZE_HANDLE_ATTRIBUTE = "data-resize-handle"
export const RESIZE_EDGE_ATTRIBUTE = "data-resize-edge"

interface UseSlotDraggingOptions {
  layout: Layout
  onChange: (changes: Partial<Layout>) => void
  onSelect: (slotKey: string | null) => void
}

/**
 * All pointer handling for the grid. What happens depends on where the drag starts:
 * - empty space: draw a new slot
 * - a slot: move it
 * - a slot's resize handle: stretch that side
 *
 * The pointer handlers go on the grid element itself, not on each slot, so a drag
 * keeps working when the pointer passes over other slots or leaves the grid.
 */
export function useSlotDragging({
  layout,
  onChange,
  onSelect,
}: UseSlotDraggingOptions) {
  const [interaction, setInteraction] = useState<Interaction | null>(null)
  const preview = getPreview(interaction, layout)

  function cellFromEvent(event: PointerEvent<HTMLElement>) {
    return cellAtPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      layout.columns,
      layout.rows
    )
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return

    const target = event.target as HTMLElement
    const resizeHandle = target.closest<HTMLElement>(
      `[${RESIZE_HANDLE_ATTRIBUTE}]`
    )
    const slotElement = target.closest<HTMLElement>(`[${SLOT_ATTRIBUTE}]`)
    const cell = cellFromEvent(event)

    // Capture the pointer so the drag keeps tracking when it leaves the grid
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()

    if (resizeHandle) {
      const slotKey = resizeHandle.getAttribute(RESIZE_HANDLE_ATTRIBUTE)!
      const edge = resizeHandle.getAttribute(RESIZE_EDGE_ATTRIBUTE) as Edge
      onSelect(slotKey)
      setInteraction({ type: "resize", slotKey, edge, current: cell })
    } else if (slotElement) {
      const slotKey = slotElement.getAttribute(SLOT_ATTRIBUTE)!
      onSelect(slotKey)
      setInteraction({ type: "move", slotKey, anchor: cell, current: cell })
    } else {
      onSelect(null)
      setInteraction({ type: "draw", anchor: cell, current: cell })
    }
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!interaction) return

    const cell = cellFromEvent(event)
    const cellChanged =
      cell.x !== interaction.current.x || cell.y !== interaction.current.y
    if (cellChanged) setInteraction({ ...interaction, current: cell })
  }

  function onPointerUp() {
    if (preview?.valid) applyPreview(preview)
    setInteraction(null)
  }

  function applyPreview({ slotKey, rect }: Preview) {
    const { slots } = layout

    if (slotKey === null) {
      const newSlot: EditorSlot = {
        key: crypto.randomUUID(),
        slotNumber: nextSlotNumber(slots),
        ...rect,
        quantity: 0,
        capacity: NEW_SLOT_CAPACITY,
        pins: [],
      }
      onChange({ slots: [...slots, newSlot] })
      onSelect(newSlot.key)
      return
    }

    // A plain click on a slot also ends up here; don't record it as a change
    const slot = slots.find((s) => s.key === slotKey)
    if (!slot || rectsEqual(slot, rect)) return

    onChange({
      slots: slots.map((s) => (s.key === slotKey ? { ...s, ...rect } : s)),
    })
  }

  function cancel() {
    setInteraction(null)
  }

  return {
    interaction,
    preview,
    cancel,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancel,
    },
  }
}

function getPreview(
  interaction: Interaction | null,
  layout: Layout
): Preview | null {
  if (!interaction) return null

  if (interaction.type === "draw") {
    const rect = rectFromCells(interaction.anchor, interaction.current)
    return { slotKey: null, rect, valid: isFreeSpace(rect, layout.slots) }
  }

  const slot = layout.slots.find((s) => s.key === interaction.slotKey)
  if (!slot) return null

  const rect =
    interaction.type === "move"
      ? moveRect(slot, interaction.anchor, interaction.current, layout)
      : resizeRect(slot, interaction.edge, interaction.current)

  return {
    slotKey: slot.key,
    rect,
    valid: isFreeSpace(rect, layout.slots, slot.key),
  }
}
