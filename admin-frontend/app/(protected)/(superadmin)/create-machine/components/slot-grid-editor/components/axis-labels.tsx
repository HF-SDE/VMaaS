import { cn } from "@/lib/utils"

import { GAP } from "../constants"
import { gridTracks } from "../grid-placement"

interface AxisLabelsProps {
  /** horizontal: x numbers below the grid, vertical: y numbers to the left of it */
  orientation: "horizontal" | "vertical"
  count: number
  /** Inclusive [begin, end] range of numbers to emphasise, e.g. the selected slot */
  highlighted: [number, number] | null
}

export function AxisLabels({
  orientation,
  count,
  highlighted,
}: AxisLabelsProps) {
  const isVertical = orientation === "vertical"
  // y grows upwards, so the vertical axis lists the highest row first
  const values = Array.from({ length: count }, (_, i) =>
    isVertical ? count - 1 - i : i
  )

  return (
    <div
      aria-hidden
      className="grid text-xs text-muted-foreground tabular-nums select-none"
      style={{
        gap: GAP,
        ...(isVertical
          ? { gridTemplateRows: gridTracks(count) }
          : { gridTemplateColumns: gridTracks(count) }),
      }}
    >
      {values.map((value) => (
        <span
          key={value}
          className={cn(
            "flex items-center justify-center",
            isVertical ? "min-w-4" : "min-h-4",
            highlighted &&
              value >= highlighted[0] &&
              value <= highlighted[1] &&
              "font-semibold text-foreground"
          )}
        >
          {value}
        </span>
      ))}
    </div>
  )
}
