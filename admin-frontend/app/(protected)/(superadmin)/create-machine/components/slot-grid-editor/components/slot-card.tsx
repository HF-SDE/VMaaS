import { cn } from "@/lib/utils"

import { gridArea } from "../grid-placement"
import {
  RESIZE_EDGE_ATTRIBUTE,
  RESIZE_HANDLE_ATTRIBUTE,
  SLOT_ATTRIBUTE,
} from "../hooks/use-slot-dragging"
import type { Edge, EditorSlot, Rect } from "../types"

const EDGE_HANDLE_CLASSES: Record<Edge, { handle: string; grip: string }> = {
  top: { handle: "inset-x-3 top-0 h-2 cursor-ns-resize", grip: "h-1 w-6" },
  bottom: {
    handle: "inset-x-3 bottom-0 h-2 cursor-ns-resize",
    grip: "h-1 w-6",
  },
  left: { handle: "inset-y-3 left-0 w-2 cursor-ew-resize", grip: "h-6 w-1" },
  right: { handle: "inset-y-3 right-0 w-2 cursor-ew-resize", grip: "h-6 w-1" },
}

interface SlotCardProps {
  slot: EditorSlot
  /** Where to draw the slot; differs from the slot's own position while it's being dragged */
  rect: Rect
  rows: number
  resizableEdges: Edge[]
  isSelected: boolean
  isMoving: boolean
  /** Being moved or resized */
  isChanging: boolean
  /** The current move/resize would overlap another slot */
  isInvalid: boolean
}

/**
 * One slot on the grid. It has no event handlers of its own: the data attributes
 * tell the grid's pointer handler whether the slot or one of its resize handles was pressed.
 */
export function SlotCard({
  slot,
  rect,
  rows,
  resizableEdges,
  isSelected,
  isMoving,
  isChanging,
  isInvalid,
}: SlotCardProps) {
  return (
    <div
      {...{ [SLOT_ATTRIBUTE]: slot.key }}
      className={cn(
        "group relative z-10 flex cursor-grab flex-col justify-between rounded-lg border bg-card p-2 text-card-foreground shadow-sm",
        isSelected && "ring-2 ring-primary",
        isMoving && "z-30 cursor-grabbing opacity-90 shadow-lg",
        isInvalid && "ring-2 ring-destructive"
      )}
      style={gridArea(rect, rows)}
    >
      <span className="text-xs font-semibold">#{slot.slotNumber}</span>
      <span className="text-xs text-muted-foreground">
        {slot.quantity}/{slot.capacity}
      </span>

      {resizableEdges.map((edge) => (
        <div
          key={edge}
          {...{
            [RESIZE_HANDLE_ATTRIBUTE]: slot.key,
            [RESIZE_EDGE_ATTRIBUTE]: edge,
          }}
          aria-hidden
          className={cn(
            "absolute flex items-center justify-center",
            EDGE_HANDLE_CLASSES[edge].handle
          )}
        >
          {/* The visible grip; shown on hover, or always while selected/dragged */}
          <span
            className={cn(
              "rounded-full bg-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100",
              (isSelected || isChanging) && "opacity-100",
              EDGE_HANDLE_CLASSES[edge].grip
            )}
          />
        </div>
      ))}
    </div>
  )
}
