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
import { formatDate } from "@/lib/utils"

import type { MachineListItem } from "./form"
import { STATUS_LABEL, STATUS_VARIANT } from "./status"

function MachineActionsCell({ machine }: { machine: MachineListItem }) {
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
          render={<Link href={`/machines/${machine.id}`}>View machine</Link>}
        />
        <DropdownMenuItem
          render={<Link href={`/sites/${machine.site.id}`}>View site</Link>}
        />
        <DropdownMenuItem
          onClick={() => navigator.clipboard.writeText(machine.id)}
        >
          Copy ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Column definitions for the machines DataTable.
 *
 * Sorting is server-side, so a column is only sortable when the backend accepts
 * it in `sortBy` (see MACHINE_SORT_FIELDS in shared/types/machine.ts) — anything
 * else would render a sort arrow that silently changes nothing. `site` is in that
 * list and sorts by the site's name, not by the `siteId` column.
 *
 * Cells read `row.original` rather than `row.getValue()`: v9 widens a mixed
 * column array's `TValue` to `CellData`, which is not renderable without a cast.
 */
export const machineColumns: ColumnDef<DataTableFeatures, MachineListItem>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Link
          href={`/machines/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
      </div>
    ),
  },
  {
    id: "site",
    accessorKey: "site",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Site" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/sites/${row.original.site.id}`}
        className="hover:underline"
        title={row.original.site.city ?? undefined}
      >
        {row.original.site.name}
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANT[row.original.status]}>
        {STATUS_LABEL[row.original.status]}
      </Badge>
    ),
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
    cell: ({ row }) => <MachineActionsCell machine={row.original} />,
  },
]

/** Column id → label, for the column-visibility dropdown. */
export const machineColumnNames: Record<string, string> = {
  name: "Name",
  site: "Site",
  status: "Status",
  createdAt: "Created",
  id: "ID",
}
