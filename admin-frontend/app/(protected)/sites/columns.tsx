"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal } from "lucide-react"

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
import { formatDate } from "@/lib/utils"
import { Site } from "@prisma"

function SiteActionsCell({ site }: { site: Site }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="h-8 w-8 p-0" />}
      >
        <span className="sr-only">Open menu</span>
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem
          render={<Link href={`/sites/${site.id}`}>View site</Link>}
        />
        <DropdownMenuItem
          onClick={() => navigator.clipboard.writeText(site.id)}
        >
          Copy ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The address on one line, or a dash when nothing has been filled in. */
function addressLine(site: Site): string {
  const parts = [site.addressLine1, site.postalCode, site.city].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : "—"
}

/**
 * Column definitions for the sites DataTable.
 *
 * Sorting is server-side, so a column is only sortable when the backend accepts
 * it in `sortBy` (see SITE_SORT_FIELDS in shared/types/site.ts) — anything else
 * would render a sort arrow that silently changes nothing. That is why the
 * address column has sorting off: it is composed out of three columns.
 *
 * Cells read `row.original` rather than `row.getValue()`: v9 widens a mixed
 * column array's `TValue` to `CellData`, which is not renderable without a cast.
 */
export const siteColumns: ColumnDef<DataTableFeatures, Site>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/sites/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "address",
    enableSorting: false,
    header: () => <span className="text-sm font-medium">Address</span>,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{addressLine(row.original)}</span>
    ),
  },
  {
    accessorKey: "city",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="City" />
    ),
    cell: ({ row }) => <span>{row.original.city || "—"}</span>,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
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
    cell: ({ row }) => <SiteActionsCell site={row.original} />,
  },
]

/** Column id → label, for the column-visibility dropdown. */
export const siteColumnNames: Record<string, string> = {
  name: "Name",
  address: "Address",
  city: "City",
  createdAt: "Created",
  id: "ID",
}
