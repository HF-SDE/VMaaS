"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal } from "lucide-react"
import type { MembersResponse } from "@backend-responses"

import { Badge } from "@/components/ui/badge"

import type { DataTableFeatures } from "@/components/data-table-generic"
import { Button } from "@/components/ui/button"
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDate } from "@/lib/utils"

import type { TenantRole } from "./page"
import { RoleSelect } from "./role-select"

export type UserColumnOptions = {
  /** The signed-in user's id — their own row never offers a role change or a
   *  removal, the same rule the members page applies. */
  currentUserId: string
  /** Roles assignable inside the active tenant. Without them the Role column
   *  falls back to a read-only badge, so a missing `role:view` degrades the
   *  cell rather than breaking it. */
  tenantRoles?: TenantRole[]
  canChangeRoles: boolean
  canRemoveUsers: boolean
  /** Takes the user id rather than the row: it ends up calling a server action,
   *  and an id is the only part of the row that action needs. Without a handler
   *  the item stays hidden rather than dead. */
  onRemoveMember?: (userId: string) => void
}

function UserActionsCell({
  member,
  canRemove,
  onRemove,
}: {
  member: MembersResponse
  canRemove: boolean
  onRemove?: (userId: string) => void
}) {
  return (
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
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(member.user.id)}
          >
            Copy user ID
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(member.user.email)}
          >
            Copy email
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {canRemove && onRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemove(member.user.id)}
              >
                Remove from tenant
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Column definitions for the members DataTable.
 *
 * A factory rather than the constant `machineColumns` is: the Role cell needs
 * the tenant's roles, the caller's permissions and the signed-in user's id, and
 * a v9 column def is static — so that context has to be closed over when the
 * columns are built. Memoize the result in the component, or every render
 * hands the table a new column array.
 *
 * Sorting is server-side, so a column is only sortable when the backend accepts
 * it in `sortBy` (see MEMBER_SORT_FIELDS in shared/types/member.ts) — anything
 * else would render a sort arrow that silently changes nothing. `name`, `email`
 * and `role` are all in that list and sort through a relation. There is no user
 * detail route yet, so the name is plain text where the machines table links.
 *
 * Cells read `row.original` rather than `row.getValue()`: v9 widens a mixed
 * column array's `TValue` to `CellData`, which is not renderable without a cast.
 */
export function createUserColumns({
  currentUserId,
  tenantRoles,
  canChangeRoles,
  canRemoveUsers,
  onRemoveMember,
}: UserColumnOptions): ColumnDef<DataTableFeatures, MembersResponse>[] {
  const isSelf = (member: MembersResponse) => member.user.id === currentUserId

  return [
    {
      id: "name",
      accessorKey: "user.name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.user.name}</span>
          {isSelf(row.original) && <Badge variant="outline">You</Badge>}
        </div>
      ),
    },
    {
      id: "email",
      accessorKey: "user.email",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Email" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.user.email}</span>
      ),
    },
    {
      id: "role",
      accessorKey: "role",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Role" />
      ),
      cell: ({ row }) =>
        canChangeRoles && tenantRoles && !isSelf(row.original) ? (
          // RoleSelect owns its own PUT, so the cell needs no handler.
          <RoleSelect tenant_roles={tenantRoles} member={row.original} />
        ) : (
          <Badge variant="secondary">{row.original.role.name}</Badge>
        ),
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Joined" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: "userId",
      accessorKey: "userId",
      enableSorting: false,
      header: () => <span className="text-sm font-medium">User ID</span>,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.user.id}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <UserActionsCell
          member={row.original}
          canRemove={canRemoveUsers && !isSelf(row.original)}
          onRemove={onRemoveMember}
        />
      ),
    },
  ]
}

/** Column id → label, for the column-visibility dropdown. */
export const userColumnNames: Record<string, string> = {
  name: "Name",
  email: "Email",
  role: "Role",
  createdAt: "Joined",
  userId: "User ID",
}
