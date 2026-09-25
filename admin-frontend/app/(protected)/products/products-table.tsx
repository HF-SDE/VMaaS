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
import { FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDebounce } from "@/hooks/use-debounce"

import { productColumnNames, productColumns } from "./columns"
import { productsErrorMessage } from "./messages"
import { toast } from "sonner"
import { Product } from "@prisma"
import { GetPaginatedResult } from "@vmaas/shared/types/data-table"
import { fetchData } from "@/lib/data/data-fetch"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMN_VISIBILITY_KEY = "products-table:column-visibility"

const DEFAULT_PAGE_SIZE = 10
const DEFAULT_ORDER_BY = "createdAt"
const DEFAULT_ORDER_DIR = "desc"

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
 * Client component that wires the reusable `<DataTable>` to the
 * `getProductsAction` server action with server-side pagination, sorting,
 * and debounced search.
 *
 * **URL query params** drive the table state so the view is shareable
 * and survives browser back/forward navigation:
 *  - `page`     – 0-based page index
 *  - `size`     – rows per page
 *  - `q`        – search query
 *  - `orderBy`  – column id to sort by
 *  - `orderDir` – "asc" | "desc"
 *
 * **Column visibility** is persisted in `localStorage` under the key
 * `products-table:column-visibility`.
 */
export function ProductsDataTable({
  initialData,
}: {
  initialData?: GetPaginatedResult<Product>
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
  const includeArchived = searchParams.get("archived") === "1"

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
  const [data, setData] = React.useState<Product[]>(initialData?.data ?? [])
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
      const [error, products] = await fetchData<GetPaginatedResult<Product>>(
        "/api/products/paginated",
        {
          // Listed field by field rather than spread: an object literal is what makes
          // this assignable to the `query` record, and it keeps the wire names visible.
          query: {
            page: pageIndex,
            pageSize: pageSize,
            sortBy: orderBy,
            sortOrder: orderDir,
            search: searchQuery,
            includeArchived: includeArchived,
          },
        }
      )

      if (error) {
        const status = error?.status
        toast.error(productsErrorMessage(status))
      } else {
        setError(null)
        setData(products.data)
        setPageCount(products.pageCount)
        setTotalCount(products.totalCount)
      }
    })
  }, [pageIndex, pageSize, orderBy, orderDir, searchQuery, includeArchived])

  // Skip the first fetch when the server already provided data for the
  // current params — subsequent param changes (page, sort, search) will
  // still trigger a fresh Server Action call as normal.
  const skipFirstFetch = React.useRef(initialData !== undefined)

  React.useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false
      return
    }
    fetchData_()
  }, [fetchData_])

  // -- Toolbar ----------------------------------------------------------------
  const toolbar = (table: DataTableInstance<Product>) => (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Søg produkter..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </div>
        {totalCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {totalCount} produkt{totalCount !== 1 ? "er" : ""}
          </p>
        )}
      </div>

      {/* Archived products are filtered out server-side, so this has to reset
          the page — page 5 of the short list would otherwise come back empty. */}
      <FieldLabel className="gap-2 text-sm font-normal text-muted-foreground">
        <Switch
          checked={includeArchived}
          onCheckedChange={(checked) =>
            updateParams({ archived: checked ? "1" : null, page: null })
          }
        />
        Vis arkiverede
      </FieldLabel>

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
                {productColumnNames[column.id] || column.id}
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
        columns={productColumns}
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
