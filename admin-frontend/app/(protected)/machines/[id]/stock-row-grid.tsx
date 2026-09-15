import { StockRow } from "@vmaas/shared/types/stock-row"
import { getBounds, normalize } from "@vmaas/shared/lib/cords-grid"
type StockGridProps = {
  stockRows: StockRow[]
}

function getGridPosition(
  row: StockRow,
  bounds: NonNullable<ReturnType<typeof getBounds>>
) {
  const { minX, maxX, minY, maxY } = normalize(row)

  return {
    // CSS columns go left -> right
    column: minX - bounds.minX + 1,

    // CSS rows go top -> bottom, so Y needs to be flipped
    row: bounds.maxY - maxY + 1,

    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

export function StockGrid({ stockRows }: StockGridProps) {
  const bounds = getBounds(stockRows)

  if (!bounds) return null

  const slotCount = bounds.width * bounds.height

  // Cells grow to fill the container but never shrink below 60px, so a grid
  // too large for its box overflows into the scroll container instead of
  // collapsing.
  const template = {
    gridTemplateColumns: `repeat(${bounds.width}, minmax(60px, 1fr))`,
    gridTemplateRows: `repeat(${bounds.height}, minmax(60px, 1fr))`,
  }

  // No explicit width/height on the wrapper: as a grid/flex item it stretches
  // to its container on both axes, which a percentage height cannot do against
  // an auto-sized parent.
  return (
    <div className="relative grid" style={template}>
      {/* Empty grid slots */}
      {Array.from({ length: slotCount }).map((_, index) => (
        <div key={index} className="border border-neutral-200" />
      ))}

      {/* Stock rows */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={template}
      >
        {stockRows.map((stockRow, index) => {
          const position = getGridPosition(stockRow, bounds)

          return (
            <div
              key={index}
              className="m-1 rounded-md border border-neutral-400 bg-neutral-100"
              style={{
                gridColumn: `${position.column} / span ${position.width}`,
                gridRow: `${position.row} / span ${position.height}`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
