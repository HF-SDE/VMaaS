"use client"

import * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn, formatPrice } from "@/lib/utils"
import { getBounds, normalize } from "@vmaas/shared/lib/cords-grid"
import type { StockRow } from "@vmaas/shared/types/stock-row"

import { axis, type SlotListItem } from "./slot-columns"
import { EditSlotForm } from "./slot-form"

type StockGridProps = {
  slots: SlotListItem[]
}

/** The slot's box in the coordinate system `cords-grid` works in. */
function toStockRow(slot: SlotListItem): StockRow {
  return {
    x_start: slot.beginX,
    x_end: slot.endX,
    y_start: slot.beginY,
    y_end: slot.endY,
  }
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

type StockLevel = "low" | "medium" | "ok"

/** How full the slot is, in the three steps the colours stand for. A slot with
 *  no capacity counts as empty rather than as a division by zero. */
function stockLevel({ quantity, capacity }: SlotListItem): StockLevel {
  const ratio = capacity > 0 ? quantity / capacity : 0

  if (ratio <= 0.25) return "low"
  if (ratio <= 0.6) return "medium"
  return "ok"
}

const LEVEL_CLASS: Record<StockLevel, string> = {
  low: "border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-300",
  medium:
    "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ok: "border-blue-500/60 bg-blue-500/15 text-blue-700 dark:text-blue-300",
}

const LEVEL_LABEL: Record<StockLevel, string> = {
  low: "Needs refilling",
  medium: "Running low",
  ok: "Well stocked",
}

/**
 * One slot in the machine: its number and what is left in it, coloured by how
 * full it is, with the rest of the detail behind a popover.
 *
 * The edit dialog is a sibling of the popover rather than a child of its
 * content, for the same reason the slots table keeps it outside the dropdown:
 * opening it closes the popover, which would unmount a dialog rendered inside.
 */
function SlotCell({
  slot,
  style,
}: {
  slot: SlotListItem
  style: React.CSSProperties
}) {
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)

  const level = stockLevel(slot)

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              // The layer this sits in is click-through so the empty cells
              // behind it stay inert; the slots themselves are not.
              className={cn(
                "pointer-events-auto m-1 flex flex-col items-center justify-center gap-0.5 rounded-md border text-center transition-colors hover:brightness-95",
                LEVEL_CLASS[level]
              )}
              style={style}
            />
          }
        >
          <span className="text-sm font-semibold tabular-nums">
            {slot.slotNumber}
          </span>
          <span className="text-[10px] tabular-nums opacity-80">
            {slot.quantity}/{slot.capacity}
          </span>
        </PopoverTrigger>

        <PopoverContent className="w-64">
          <PopoverHeader>
            <PopoverTitle>Slot {slot.slotNumber}</PopoverTitle>
            <PopoverDescription>
              {slot.product?.name ?? "Empty"}
            </PopoverDescription>
          </PopoverHeader>

          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted-foreground">Stock</dt>
            <dd className="text-right tabular-nums">
              {slot.quantity} / {slot.capacity}
            </dd>

            <dt className="text-muted-foreground">Level</dt>
            <dd className="text-right">{LEVEL_LABEL[level]}</dd>

            <dt className="text-muted-foreground">Price</dt>
            <dd className="text-right tabular-nums">
              {/* Null is the slot not overriding what the product costs. */}
              {slot.price === null
                ? "Product price"
                : formatPrice(Number(slot.price))}
            </dd>

            <dt className="text-muted-foreground">Position</dt>
            <dd className="text-right font-mono text-xs">
              {axis("x", slot.beginX, slot.endX)}{" "}
              {axis("y", slot.beginY, slot.endY)}
            </dd>
          </dl>

          <div className="flex justify-end gap-2">
            {slot.product && (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/products/${slot.product.id}`} />}
              >
                View product
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setPopoverOpen(false)
                setEditOpen(true)
              }}
            >
              Edit slot
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit slot {slot.slotNumber}</DialogTitle>
            <DialogDescription>
              {slot.product
                ? `Change what slot ${slot.slotNumber} holds of ${slot.product.name}, how much fits, and what it costs.`
                : `Slot ${slot.slotNumber} is empty. Set how much fits and what it costs.`}
            </DialogDescription>
          </DialogHeader>
          <EditSlotForm
            id={slot.id}
            defaultProduct={slot.product}
            defaultValues={{
              quantity: slot.quantity,
              capacity: slot.capacity,
              price: slot.price === null ? null : Number(slot.price),
            }}
            onSaved={() => setEditOpen(false)}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

export function StockGrid({ slots }: StockGridProps) {
  const bounds = getBounds(slots.map(toStockRow))

  if (!bounds) {
    return (
      <p className="place-self-center text-sm text-muted-foreground">
        This machine has no slots yet.
      </p>
    )
  }

  const cellCount = bounds.width * bounds.height

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
      {Array.from({ length: cellCount }).map((_, index) => (
        <div key={index} className="border border-border" />
      ))}

      {/* Slots */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={template}
      >
        {slots.map((slot) => {
          const position = getGridPosition(toStockRow(slot), bounds)

          return (
            <SlotCell
              key={slot.id}
              slot={slot}
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
