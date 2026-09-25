"use client"

import * as React from "react"
import type { ColumnVisibilityState, SortingState } from "@tanstack/react-table"
import { Search, Settings2 } from "lucide-react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"

import {
  DataTable,
  type DataTableInstance,
} from "@/components/data-table-generic"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDebounce } from "@/hooks/use-debounce"

import { createUserColumns, userColumnNames } from "./columns"
import { toast } from "sonner"
import { GetPaginatedResult } from "@vmaas/shared/types/data-table"
import { fetchData } from "@/lib/data/data-fetch"
import type { MembersResponse } from "@backend-responses"
import type { TenantRole } from "./page"
import { membersErrorMessage } from "./messages"
import { RemoveMemberResult } from "./actions"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMN_VISIBILITY_KEY = "users-table:column-visibility"

const DEFAULT_PAGE_SIZE = 10
const DEFAULT_ORDER_BY = "name"
const DEFAULT_ORDER_DIR = "asc"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readColumnVisibility(): ColumnVisibilityState {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY)
    return raw ? (JSON.parse(raw) as ColumnVisibilityState) : {}
  } catch {
    return {}
  }
}

function writeColumnVisibility(state: ColumnVisibilityState) {
  try {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(state))
  } catch {
    // ignore quota / SSR errors
  }
}

/** A hand-edited `?page=abc` must not turn into `NaN` and blank the table. */
function readNumber(raw: string | null, fallback: number): number {
  const parsed = Number(raw)
  return raw !== null && Number.isFinite(parsed) ? parsed : fallback
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component that wires the reusable `<DataTable>` to
 * `GET /api/tenants/members/paginated` with server-side pagination, sorting,
 * and debounced search.
 *
 * The route answers `MembersPageResponse` — `GetPaginatedResult` over the same
 * row the unpaginated `GET /members` returns, so `MembersResponse` types both.
 * It takes `page`/`pageSize`/`sortBy`/`sortOrder`/`search`, with `sortBy`
 * whitelisted against MEMBER_SORT_FIELDS and everything else clamped rather
 * than rejected.
 *
 * **URL query params** drive the table state so the view is shareable
 * and survives browser back/forward navigation:
 *  - `page`     – 0-based page index
 *  - `size`     – rows per page
 *  - `q`        – search query, matched against the member's name and email
 *  - `orderBy`  – column id to sort by
 *  - `orderDir` – "asc" | "desc"
 *
 * Rows sort by name rather than by `createdAt` as the machines table does: a
 * member list is read by looking someone up, not by recency of joining.
 *
 * Permissions arrive as props rather than from `useSession()`: the protected
 * layout seeds `<SessionProvider>` around the sidebar only, so a page's own
 * subtree has no session context to read. They decide nothing on their own —
 * `<RoleGate>` is what keeps the table off the page, and the backend re-checks
 * every call these gates let through.
 *
 * **Column visibility** is persisted in `localStorage` under the key
 * `users-table:column-visibility`.
 */
export function UsersDataTable({
  initialData,
  currentUserId,
  canChangeRoles = false,
  canRemoveUsers = false,
  tenantRoles,
  onRemoveMember,
}: {
  initialData?: GetPaginatedResult<MembersResponse>
  /** From the page's `requirePermission` session — their own row offers neither
   *  a role change nor a removal. */
  currentUserId: string
  canChangeRoles?: boolean
  canRemoveUsers?: boolean
  /** Roles assignable in the active tenant, from `GET /api/tenants/roles`.
   *  Omit them and the Role column stays a read-only badge. */
  tenantRoles?: TenantRole[]
  /** The `removeMember` server action. Without it the row hides "Remove from
   *  tenant" rather than offering a dead menu item. */
  onRemoveMember?: (userId: string) => Promise<RemoveMemberResult>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // -- Parse URL params (source of truth for table state) --------------------
  const pageIndex = readNumber(searchParams.get("page"), 0)
  const pageSize = readNumber(searchParams.get("size"), DEFAULT_PAGE_SIZE)
  const searchQuery = searchParams.get("q") ?? ""
  const orderBy = searchParams.get("orderBy") ?? DEFAULT_ORDER_BY
  const orderDir = (searchParams.get("orderDir") ?? DEFAULT_ORDER_DIR) as
    "asc" | "desc"

  // -- Controlled search input (debounced before pushing to URL) -------------
  const [searchInput, setSearchInput] = React.useState(searchQuery)
  const debouncedSearch = useDebounce(searchInput, 300)

  // Sync input field when the URL changes externally (back/forward nav)
  React.useEffect(() => {
    setSearchInput(searchQuery)
  }, [searchQuery])

  // -- Column visibility (localStorage) -------------------------------------
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>(readColumnVisibility)

  const handleColumnVisibilityChange = React.useCallback(
    (visibility: ColumnVisibilityState) => {
      setColumnVisibility(visibility)
      writeColumnVisibility(visibility)
    },
    []
  )

  // -- Data state -------------------------------------------------------------
  const [data, setData] = React.useState<MembersResponse[]>(
    initialData?.data ?? []
  )
  const [pageCount, setPageCount] = React.useState(initialData?.pageCount ?? 0)
  const [totalCount, setTotalCount] = React.useState(
    initialData?.totalCount ?? 0
  )
  const [error, setError] = React.useState<string | null>(null)

  // -- Loading state ----------------------------------------------------------
  const [isLoading, startTransition] = React.useTransition()

  // -- URL param updater (uses replace so back/forward works naturally) -------
  const updateParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  // Push debounced search to URL (reset to page 0)
  React.useEffect(() => {
    if (debouncedSearch !== searchQuery) {
      updateParams({ q: debouncedSearch || null, page: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  // -- Sorting state derived from URL ----------------------------------------
  const sorting: SortingState = React.useMemo(
    () => [{ id: orderBy, desc: orderDir === "desc" }],
    [orderBy, orderDir]
  )

  // -- Fetch data whenever URL-driven state changes --------------------------
  const fetchData_ = React.useCallback(() => {
    startTransition(async () => {
      const [error, members] = await fetchData<
        GetPaginatedResult<MembersResponse>
      >("/api/tenants/members/paginated", {
        // Listed field by field rather than spread: an object literal is what makes
        // this assignable to the `query` record, and it keeps the wire names visible.
        query: {
          page: pageIndex,
          pageSize: pageSize,
          sortBy: orderBy,
          sortOrder: orderDir,
          search: searchQuery,
        },
      })

      if (error) {
        // Shown in the table's own alert as well as toasted: a member list that
        // failed to load has to say so where the rows would have been.
        const message = membersErrorMessage(error.status)
        setError(message)
        toast.error(message)
      } else {
        setError(null)
        setData(members.data)
        setPageCount(members.pageCount)
        setTotalCount(members.totalCount)
      }
    })
  }, [pageIndex, pageSize, orderBy, orderDir, searchQuery])

  // -- Removal ----------------------------------------------------------------
  // The action revalidates the server render, which the table's own copy of the
  // rows never sees — so the page it is showing is refetched here instead.
  const handleRemoveMember = React.useCallback(
    async (userId: string) => {
      if (!onRemoveMember) return

      const [error] = await onRemoveMember(userId)

      if (error) {
        toast.error(error.reason)
        return
      }

      toast.success("Member removed.")
      fetchData_()
    },
    [onRemoveMember, fetchData_]
  )

  // -- Columns ----------------------------------------------------------------
  // Rebuilt only when the row context changes: a fresh array on every render
  // would reset the table's column state.
  const columns = React.useMemo(
    () =>
      createUserColumns({
        currentUserId,
        tenantRoles,
        canChangeRoles,
        canRemoveUsers,
        onRemoveMember: onRemoveMember && handleRemoveMember,
      }),
    [
      currentUserId,
      tenantRoles,
      canChangeRoles,
      canRemoveUsers,
      onRemoveMember,
      handleRemoveMember,
    ]
  )

  // Skip the first fetch when the server already provided data for the
  // current params — subsequent param changes (page, sort, search) will
  // still trigger a fresh request as normal.
  const skipFirstFetch = React.useRef(initialData !== undefined)

  React.useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false
      return
    }
    fetchData_()
  }, [fetchData_])

  // -- Toolbar ----------------------------------------------------------------
  const toolbar = (table: DataTableInstance<MembersResponse>) => (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members by name or email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </div>
        {totalCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {totalCount} member{totalCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Column visibility dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="ml-auto h-8" />
          }
        >
          <Settings2 className="mr-2 h-4 w-4" />
          Columns
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {table
            .getAllColumns()
            .filter((column) => column.getCanHide())
            .map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                className="capitalize"
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {userColumnNames[column.id] || column.id}
              </DropdownMenuCheckboxItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DataTable
        columns={columns}
        data={data}
        pageCount={pageCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPageChange={(page) =>
          updateParams({ page: page === 0 ? null : String(page) })
        }
        onPageSizeChange={(size) =>
          updateParams({
            size: size === DEFAULT_PAGE_SIZE ? null : String(size),
            page: null,
          })
        }
        sorting={sorting}
        onSortingChange={(next) => {
          const [sort] = next
          updateParams({
            orderBy: sort?.id ?? null,
            orderDir: sort ? (sort.desc ? "desc" : "asc") : null,
            page: null,
          })
        }}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        isLoading={isLoading}
        toolbar={toolbar}
      />
    </div>
  )
}
