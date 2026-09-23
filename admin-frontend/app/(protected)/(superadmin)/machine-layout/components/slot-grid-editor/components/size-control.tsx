import { Minus, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { GAP } from "../constants"

interface SizeControlProps {
  /** horizontal: a bar above the grid, vertical: a bar to the right of it */
  orientation: "horizontal" | "vertical"
  /** "row" or "column", used in the button labels */
  label: string
  /** Hidden entirely when there is only one row/column left */
  showDecrease: boolean
  /** Disabled when a slot reaches into the row/column that would be removed */
  canDecrease: boolean
  onDecrease: () => void
  onIncrease: () => void
}

/** A bar along the grid, split into a + half and a − half */
export function SizeControl({
  orientation,
  label,
  showDecrease,
  canDecrease,
  onDecrease,
  onIncrease,
}: SizeControlProps) {
  const isVertical = orientation === "vertical"
  const buttonClassName = cn("flex-1", isVertical ? "h-auto w-8" : "h-8")

  return (
    <div
      className={cn("flex", isVertical ? "flex-col" : "flex-row")}
      style={{ gap: GAP }}
    >
      <Button
        variant="outline"
        className={buttonClassName}
        onClick={onIncrease}
        aria-label={`Add ${label}`}
      >
        <Plus />
      </Button>

      {showDecrease && (
        <Button
          variant="outline"
          className={buttonClassName}
          onClick={onDecrease}
          disabled={!canDecrease}
          aria-label={`Remove ${label}`}
          title={
            canDecrease ? undefined : `A slot is placed in the last ${label}`
          }
        >
          <Minus />
        </Button>
      )}
    </div>
  )
}
