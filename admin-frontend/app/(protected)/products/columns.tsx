"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal } from "lucide-react"
import type { Product } from "@vmaas/shared/types/product"

import type { DataTableFeatures } from "@/components/data-table-generic"
import { Button } from "@/components/ui/button"
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDate, formatPrice } from "@/lib/utils"

function ProductActionsCell({ product }: { product: Product }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="h-8 w-8 p-0" />}
      >
        <span className="sr-only">Åbn menu</span>
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Handlinger</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => navigator.clipboard.writeText(product.id)}
        >
          Kopiér ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Column definitions for the products DataTable.
 *
 * Sorting is server-side, so a column is only sortable when the backend accepts
 * it in `sortBy` (see PRODUCT_SORT_FIELDS in shared/types/product.ts) — anything
 * else would render a sort arrow that silently changes nothing.
 *
 * Cells read `row.original` rather than `row.getValue()`: v9 widens a mixed
 * column array's `TValue` to `CellData`, which is not renderable without a cast.
 */
export const productColumns: ColumnDef<DataTableFeatures, Product>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Navn" />
    ),
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "price",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Pris" />
    ),
    cell: ({ row }) => (
      <span className="tabular-nums">{formatPrice(row.original.price)}</span>
    ),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Oprettet" />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  },
  {
    id: "id",
    accessorKey: "id",
    enableSorting: false,
    header: () => <span className="text-sm font-medium">ID</span>,
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-xs">
        {row.original.id}
      </span>
    ),
  },
  {
    id: "actions",
    enableHiding: false,
    enableSorting: false,
    cell: ({ row }) => <ProductActionsCell product={row.original} />,
  },
]

/** Column id → Danish label, for the column-visibility dropdown. */
export const productColumnNames: Record<string, string> = {
  name: "Navn",
  price: "Pris",
  createdAt: "Oprettet",
  id: "ID",
}
