"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal } from "lucide-react"

import { Badge } from "@/components/ui/badge"

import type { DataTableFeatures } from "@/components/data-table-generic"
import { Button } from "@/components/ui/button"
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatPrice } from "@/lib/utils"
import type { Slot } from "@prisma"
import type { SlotProduct } from "@vmaas/shared/types/slot"

import { EditSlotForm } from "./slot-form"

/** One row of the slots table — a slot with the product loaded in it, as
 *  `GET /api/slots` returns it. */
export type SlotListItem = Slot & { product: SlotProduct }

function SlotActionsCell({ slot }: { slot: SlotListItem }) {
  const [editOpen, setEditOpen] = React.useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="h-8 w-8 p-0" />}
        >
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              Edit slot
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link href={`/products/${slot.product.id}`}>View product</Link>
              }
            />
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(slot.id)}
            >
              Copy ID
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu rather than inside the item: the item closes the menu
          when it is clicked, which would take a dialog rendered under it with
          it. The item only flips the state this dialog is controlled by. */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit slot {slot.slotNumber}</DialogTitle>
            <DialogDescription>
              Change what slot {slot.slotNumber} holds of {slot.product.name},
              how much fits, and what it costs.
            </DialogDescription>
          </DialogHeader>
          <EditSlotForm
            id={slot.id}
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

/** `x −5…−4` for a slot two columns wide, `x −3` for one that is a single
 *  column — a range that starts and ends in the same place reads as a point. */
function axis(label: string, begin: number, end: number): string {
  return begin === end ? `${label}${begin}` : `${label}${begin}…${end}`
}

/**
 * Column definitions for the slots DataTable on a machine's detail page.
 *
 * Sorting and filtering are client-side here, unlike every other table in the
 * app: a machine holds a few dozen slots, so they all arrive in one response and
 * `<DataTable>` sorts them itself. A column is therefore sortable unless it has
 * nothing to sort by, rather than because the backend accepts it in `sortBy`.
 *
 * Cells read `row.original` rather than `row.getValue()`: v9 widens a mixed
 * column array's `TValue` to `CellData`, which is not renderable without a cast.
 */
export const slotColumns: ColumnDef<DataTableFeatures, SlotListItem>[] = [
  {
    accessorKey: "slotNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Slot" />
    ),
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.slotNumber}
      </span>
    ),
  },
  {
    id: "product",
    accessorFn: (row) => row.product.name,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/products/${row.original.product.id}`}
        className="font-medium hover:underline"
      >
        {row.original.product.name}
      </Link>
    ),
  },
  {
    // Sorts on what is left in the slot rather than on how full it is: an empty
    // slot is what needs refilling, whatever its capacity.
    accessorKey: "quantity",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Stock" />
    ),
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          {row.original.quantity} / {row.original.capacity}
        </span>
        {row.original.quantity === 0 && (
          <Badge variant="secondary">Empty</Badge>
        )}
      </div>
    ),
  },
  {
    accessorKey: "price",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Price" />
    ),
    // Null means the slot does not override what the product costs, so there is
    // no figure of its own to show.
    cell: ({ row }) =>
      row.original.price === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">
          {formatPrice(Number(row.original.price))}
        </span>
      ),
  },
  {
    id: "position",
    // A bounding box has no order to put rows in — sorting by one corner of it
    // would be an arrow that means nothing.
    enableSorting: false,
    header: () => <span className="text-sm font-medium">Position</span>,
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {axis("x", row.original.beginX, row.original.endX)}{" "}
        {axis("y", row.original.beginY, row.original.endY)}
      </span>
    ),
  },
  {
    id: "actions",
    enableHiding: false,
    enableSorting: false,
    cell: ({ row }) => <SlotActionsCell slot={row.original} />,
  },
]

/** Column id → label, for the column-visibility dropdown. */
export const slotColumnNames: Record<string, string> = {
  slotNumber: "Slot",
  product: "Product",
  quantity: "Stock",
  price: "Price",
  position: "Position",
}
