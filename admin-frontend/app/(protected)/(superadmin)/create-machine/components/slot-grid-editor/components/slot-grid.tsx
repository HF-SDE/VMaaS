import type { KeyboardEvent, PointerEvent } from "react"

import { cn } from "@/lib/utils"

import { GAP } from "../constants"
import { gridArea, gridRowLine, gridTracks } from "../grid-placement"
import { getResizableEdges } from "../layout-math"
import type { Cell, Interaction, Layout, Preview } from "../types"
import { SlotCard } from "./slot-card"

interface SlotGridProps {
  layout: Layout
  selectedKey: string | null
  /** Slots to outline as invalid, e.g. slots that failed the check when saving */
  invalidSlotKeys: Set<string>
  interaction: Interaction | null
  preview: Preview | null
  pointerHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
  }
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}

/** The grid itself: empty background cells, the slots on top, and the preview of a slot being drawn */
export function SlotGrid({
  layout,
  selectedKey,
  invalidSlotKeys,
  interaction,
  preview,
  pointerHandlers,
  onKeyDown,
}: SlotGridProps) {
  const { slots, columns, rows } = layout

  return (
    <div
      role="application"
      aria-label="Slot layout editor"
      tabIndex={0}
      className="relative grid w-max touch-none rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        gridTemplateColumns: gridTracks(columns),
        gridTemplateRows: gridTracks(rows),
        gap: GAP,
      }}
      {...pointerHandlers}
      onKeyDown={onKeyDown}
    >
      {allCells(columns, rows).map(({ x, y }) => (
        <div
          key={`cell-${x}-${y}`}
          className="cursor-crosshair rounded-lg border border-dashed border-muted-foreground/30"
          style={{ gridColumnStart: x + 1, gridRowStart: gridRowLine(y, rows) }}
        />
      ))}

      {slots.map((slot) => {
        const isChanging = preview?.slotKey === slot.key
        const rect = isChanging ? preview.rect : slot

        return (
          <SlotCard
            key={slot.key}
            slot={slot}
            rect={rect}
            rows={rows}
            resizableEdges={getResizableEdges(rect, layout)}
            isSelected={selectedKey === slot.key}
            isMoving={isChanging && interaction?.type === "move"}
            isChanging={isChanging}
            isInvalid={
              isChanging ? !preview.valid : invalidSlotKeys.has(slot.key)
            }
          />
        )
      })}

      {interaction?.type === "draw" && preview && (
        <div
          className={cn(
            "pointer-events-none z-20 rounded-lg border-2 border-dashed",
            preview.valid
              ? "border-primary bg-primary/10"
              : "border-destructive bg-destructive/10"
          )}
          style={gridArea(preview.rect, rows)}
        />
      )}
    </div>
  )
}

function allCells(columns: number, rows: number): Cell[] {
  const cells: Cell[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) cells.push({ x, y })
  }
  return cells
}
