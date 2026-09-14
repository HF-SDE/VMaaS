"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal } from "lucide-react"

import { Badge } from "@/components/ui/badge"

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
import { Product } from "@prisma"

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
          render={<Link href={`/products/${product.id}`}>Vis produkt</Link>}
        />
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
      <div className="flex items-center gap-2">
        <Link
          href={`/products/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
        {row.original.archivedAt && (
          <Badge variant="secondary">Arkiveret</Badge>
        )}
      </div>
    ),
  },
  {
    accessorKey: "price",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Pris" />
    ),
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatPrice(Number(row.original.price))}
      </span>
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
      <span className="font-mono text-xs text-muted-foreground">
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
  name: "Name",
  price: "Price",
  createdAt: "Created",
  archivedAt: "Archived",
  id: "ID",
}
