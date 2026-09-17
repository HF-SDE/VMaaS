/**
 * Converting between slot coordinates and the CSS grid on screen.
 *
 * CSS grid lines are 1-based and rows are counted from the top,
 * while slot coordinates are 0-based and y is counted from the bottom.
 */

import type { CSSProperties } from "react"

import { CELL_SIZE, GAP } from "./constants"
import type { Cell, Rect } from "./types"

/** The CSS grid row line at the top of slot row `y` */
export function gridRowLine(y: number, rows: number) {
  return rows - y
}

/** Style that places a rect on the CSS grid */
export function gridArea(rect: Rect, rows: number): CSSProperties {
  return {
    gridColumn: `${rect.beginX + 1} / ${rect.endX + 2}`,
    gridRow: `${gridRowLine(rect.endY, rows)} / ${gridRowLine(rect.beginY, rows) + 1}`,
  }
}

/** A grid template with `count` fixed-size tracks */
export function gridTracks(count: number) {
  return `repeat(${count}, ${CELL_SIZE}px)`
}

/** The cell under a pointer position, clamped to the grid */
export function cellAtPoint(
  grid: HTMLElement,
  clientX: number,
  clientY: number,
  columns: number,
  rows: number
): Cell {
  const bounds = grid.getBoundingClientRect()
  const column = Math.floor((clientX - bounds.left) / (CELL_SIZE + GAP))
  const rowFromTop = Math.floor((clientY - bounds.top) / (CELL_SIZE + GAP))

  return {
    x: Math.min(Math.max(column, 0), columns - 1),
    // Flip the row, since y = 0 is the bottom row
    y: Math.min(Math.max(rows - 1 - rowFromTop, 0), rows - 1),
  }
}
