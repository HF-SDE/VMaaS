/**
 * Pure calculations on slots and layouts. No React and no DOM, so everything here is easy to test.
 */

import { DEFAULT_GRID_SIZE } from "./constants"
import type { Cell, Edge, EditorSlot, Layout, Rect } from "./types"

export function layoutFromSlots(slots: EditorSlot[]): Layout {
  if (slots.length === 0) {
    return { slots, columns: DEFAULT_GRID_SIZE, rows: DEFAULT_GRID_SIZE }
  }

  return {
    slots,
    columns: Math.max(...slots.map((slot) => slot.endX + 1)),
    rows: Math.max(...slots.map((slot) => slot.endY + 1)),
  }
}

export function rectsOverlap(a: Rect, b: Rect) {
  return (
    a.beginX <= b.endX &&
    b.beginX <= a.endX &&
    a.beginY <= b.endY &&
    b.beginY <= a.endY
  )
}

export function rectsEqual(a: Rect, b: Rect) {
  return (
    a.beginX === b.beginX &&
    a.endX === b.endX &&
    a.beginY === b.beginY &&
    a.endY === b.endY
  )
}

/** Whether a rect can be placed without overlapping any slot (optionally ignoring the slot being changed) */
export function isFreeSpace(
  rect: Rect,
  slots: EditorSlot[],
  ignoreKey?: string
) {
  return !slots.some(
    (slot) => slot.key !== ignoreKey && rectsOverlap(slot, rect)
  )
}

/** The rect spanned by two opposite corner cells, in any order */
export function rectFromCells(a: Cell, b: Cell): Rect {
  return {
    beginX: Math.min(a.x, b.x),
    endX: Math.max(a.x, b.x),
    beginY: Math.min(a.y, b.y),
    endY: Math.max(a.y, b.y),
  }
}

/**
 * Shift a rect by how far the pointer moved from `anchor` to `current`,
 * clamped so the whole rect stays inside the grid.
 */
export function moveRect(
  rect: Rect,
  anchor: Cell,
  current: Cell,
  { columns, rows }: Pick<Layout, "columns" | "rows">
): Rect {
  const dx = clamp(current.x - anchor.x, -rect.beginX, columns - 1 - rect.endX)
  const dy = clamp(current.y - anchor.y, -rect.beginY, rows - 1 - rect.endY)

  return {
    beginX: rect.beginX + dx,
    endX: rect.endX + dx,
    beginY: rect.beginY + dy,
    endY: rect.endY + dy,
  }
}

/**
 * Move one edge of a rect to the pointer. The edge can't pass the opposite edge,
 * so a rect is always at least 1x1.
 */
export function resizeRect(rect: Rect, edge: Edge, current: Cell): Rect {
  return {
    beginX: edge === "left" ? Math.min(current.x, rect.endX) : rect.beginX,
    endX: edge === "right" ? Math.max(current.x, rect.beginX) : rect.endX,
    // y grows upwards, so the top edge is endY and the bottom edge is beginY
    beginY: edge === "bottom" ? Math.min(current.y, rect.endY) : rect.beginY,
    endY: edge === "top" ? Math.max(current.y, rect.beginY) : rect.endY,
  }
}

/**
 * The edges that can be dragged. An edge can be dragged if it can move in either direction:
 * outwards when it isn't touching the edge of the grid, or inwards when the rect is more than one cell.
 */
export function getResizableEdges(
  rect: Rect,
  { columns, rows }: Pick<Layout, "columns" | "rows">
): Edge[] {
  const canShrinkX = rect.endX > rect.beginX
  const canShrinkY = rect.endY > rect.beginY

  const edges: Record<Edge, boolean> = {
    top: rect.endY < rows - 1 || canShrinkY,
    right: rect.endX < columns - 1 || canShrinkX,
    bottom: rect.beginY > 0 || canShrinkY,
    left: rect.beginX > 0 || canShrinkX,
  }

  return (Object.keys(edges) as Edge[]).filter((edge) => edges[edge])
}

export function nextSlotNumber(slots: EditorSlot[]) {
  return slots.length
    ? Math.max(...slots.map((slot) => slot.slotNumber)) + 1
    : 1
}

/** Columns are removed from the right; only possible when no slot reaches into that column */
export function canRemoveColumn({ slots, columns }: Layout) {
  return columns > 1 && slots.every((slot) => slot.endX < columns - 1)
}

/** Rows are removed from the top (y grows upwards); only possible when no slot reaches into that row */
export function canRemoveRow({ slots, rows }: Layout) {
  return rows > 1 && slots.every((slot) => slot.endY < rows - 1)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
