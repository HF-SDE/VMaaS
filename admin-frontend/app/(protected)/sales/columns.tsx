"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import type { DataTableFeatures } from "@/components/data-table-generic"
import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header"
import { formatPrice } from "@/lib/utils"
import { SalesResponse } from "@/types/responses"

import { SALE_STATUS_LABEL, SALE_STATUS_VARIANT } from "./status"

const dateTimeFormat = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "medium",
  timeStyle: "short",
})

/**
 * Column definitions for the sales DataTable.
 *
 * Sorting is client-side, so every sortable column uses an `accessorFn` that
 * returns a comparable primitive — prices arrive as Decimal strings and dates as
 * ISO strings, and neither sorts correctly as-is.
 */
export const salesColumns: ColumnDef<DataTableFeatures, SalesResponse>[] = [
  {
    id: "createdAt",
    accessorFn: (sale) => new Date(sale.createdAt).getTime(),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date" />
    ),
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        {dateTimeFormat.format(new Date(row.original.createdAt))}
      </span>
    ),
  },
  {
    id: "product",
    accessorFn: (sale) => sale.product?.name ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
    ),
    cell: ({ row }) =>
      row.original.product ? (
        <Link
          href={`/products/${row.original.product.id}`}
          className="font-medium hover:underline"
        >
          {row.original.product.name}
        </Link>
      ) : (
        <span className="text-muted-foreground italic">Deleted product</span>
      ),
  },
  {
    id: "price",
    accessorFn: (sale) => Number(sale.price),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Price" />
    ),
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatPrice(String(row.original.price))}
      </span>
    ),
  },
  {
    id: "status",
    accessorFn: (sale) => sale.status,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <Badge variant={SALE_STATUS_VARIANT[row.original.status]}>
        {SALE_STATUS_LABEL[row.original.status]}
      </Badge>
    ),
  },
  {
    id: "machine",
    accessorFn: (sale) => sale.machine.name,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Machine" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/machines/${row.original.machine.id}`}
        className="hover:underline"
      >
        {row.original.machine.name}
      </Link>
    ),
  },
  {
    id: "site",
    accessorFn: (sale) => sale.machine.site.name,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Site" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/sites/${row.original.machine.site.id}`}
        className="text-muted-foreground hover:underline"
      >
        {row.original.machine.site.name}
      </Link>
    ),
  },
  {
    id: "completedAt",
    accessorFn: (sale) =>
      sale.completedAt ? new Date(sale.completedAt).getTime() : 0,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Completed" />
    ),
    cell: ({ row }) =>
      row.original.completedAt ? (
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {dateTimeFormat.format(new Date(row.original.completedAt))}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
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
]

/** Column id → label, for the column-visibility dropdown. */
export const salesColumnNames: Record<string, string> = {
  createdAt: "Date",
  product: "Product",
  price: "Price",
  status: "Status",
  machine: "Machine",
  site: "Site",
  completedAt: "Completed",
  id: "ID",
}
