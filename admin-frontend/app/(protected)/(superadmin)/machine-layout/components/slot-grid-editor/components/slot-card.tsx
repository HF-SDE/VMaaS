import { TriangleAlert, Zap } from "lucide-react"

import { cn } from "@/lib/utils"
import { DEVICE_MAX_SLOT } from "@vmaas/shared/types/slot"

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
  /**
   * GPIOs that appear on more than one slot in this machine.
   *
   * Unreachable through the editor today — the inspector refuses a duplicate and
   * the database has a unique index on (machineId, number) — so this is a
   * tripwire, not a feature: it turns a future hole in the inspector's guard
   * into something visible on the grid instead of a rejected save.
   */
  duplicatePins: Set<number>
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
  duplicatePins,
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
      <span className="flex items-center gap-1 text-xs font-semibold">
        #{slot.slotNumber}
        {slot.slotNumber > DEVICE_MAX_SLOT && (
          <TriangleAlert
            className="h-3 w-3 shrink-0 text-destructive"
            aria-label={`Slot ${slot.slotNumber} is above the ${DEVICE_MAX_SLOT} the machine can address`}
          />
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {slot.quantity}/{slot.capacity}
      </span>

      {slot.pins.length === 0 ? (
        <span className="flex items-center gap-1 text-[10px] text-destructive">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
          No pin
        </span>
      ) : (
        <span
          className="flex items-center gap-1 truncate text-[10px] text-muted-foreground"
          title={`GPIO ${slot.pins.map((pin) => pin.number).join(", ")}`}
        >
          <Zap className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">
            {slot.pins.map((pin, index) => (
              <span key={pin.number}>
                {index > 0 && ", "}
                <span
                  className={cn(
                    duplicatePins.has(pin.number) &&
                      "font-bold text-destructive"
                  )}
                >
                  {pin.number}
                </span>
              </span>
            ))}
          </span>
        </span>
      )}

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
