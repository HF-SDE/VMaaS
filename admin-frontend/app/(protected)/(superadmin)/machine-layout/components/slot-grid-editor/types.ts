/**
 * Coordinate system used throughout the editor:
 * - 0-based and inclusive: a 1x1 slot has beginX === endX and beginY === endY
 * - x grows to the right, y grows upwards (y = 0 is the bottom row)
 */

export interface EditorSlot {
  /** Stable React key; the database id for existing slots, a generated one for new slots */
  key: string
  id?: string
  slotNumber: number
  beginX: number
  endX: number
  beginY: number
  endY: number
  quantity: number
  capacity: number
  pins: { number: number; description?: string }[]
}

export type Rect = Pick<EditorSlot, "beginX" | "endX" | "beginY" | "endY">

export interface Cell {
  x: number
  y: number
}

/** The editable state of the editor. Everything in here can be undone. */
export interface Layout {
  slots: EditorSlot[]
  columns: number
  rows: number
  /** STEP pulses per vend for every motor on this machine, 1-65535. Machine-level,
   *  but kept in the layout so it is saved, reset and undone with the grid. */
  stepsPerVend: number
}

/** A side of a slot, as seen on screen */
export type Edge = "top" | "right" | "bottom" | "left"

/** A drag that is in progress */
export type Interaction =
  | { type: "draw"; anchor: Cell; current: Cell }
  | { type: "move"; slotKey: string; anchor: Cell; current: Cell }
  | { type: "resize"; slotKey: string; edge: Edge; current: Cell }

/** What the current drag would produce if the pointer was released now */
export interface Preview {
  /** The slot being moved/resized, or null when drawing a new slot */
  slotKey: string | null
  rect: Rect
  /** False when the rect overlaps another slot */
  valid: boolean
}
