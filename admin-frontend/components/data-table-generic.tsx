"use client"

import * as React from "react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type PaginationState,
  type ReactTable,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
  type Updater,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { DataTablePagination } from "./data-table-pagination"

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * v9 only bundles the features a table registers, so they are declared once
 * here rather than per table instance. The row models stay registered even for
 * server-side tables — `manualPagination`/`manualSorting`/`manualFiltering`
 * turn them into pass-throughs, which keeps the feature set (and therefore the
 * table's type) identical in both modes.
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
})

export type DataTableFeatures = typeof dataTableFeatures

/** The table instance handed to `toolbar`. Build columns against the same
 *  feature set, e.g. `createColumnHelper<DataTableFeatures, MyRow>()`. */
export type DataTableInstance<TData extends RowData> = ReactTable<
  DataTableFeatures,
  TData
>

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataTableProps<TData extends RowData> {
  /** Column definitions (tanstack ColumnDef). Columns of mixed cell types widen
   *  to v9's default `CellData`, which is what `TableOptions.columns` expects. */
  columns: ColumnDef<DataTableFeatures, TData>[]
  /** The data to display */
  data: TData[]

  // -- Pagination (server-side) -----------------------------------------------
  /** Total number of pages (required for server-side pagination) */
  pageCount?: number
  /** Current page index (0-based) */
  pageIndex?: number
  /** Current page size */
  pageSize?: number
  /** Called when page changes */
  onPageChange?: (pageIndex: number) => void
  /** Called when page size changes */
  onPageSizeChange?: (pageSize: number) => void

  // -- Sorting ----------------------------------------------------------------
  /** Current sort state */
  sorting?: SortingState
  /** Called when sorting changes */
  onSortingChange?: (sorting: SortingState) => void

  // -- Filtering --------------------------------------------------------------
  /** Current column filter state */
  columnFilters?: ColumnFiltersState
  /** Called when column filters change */
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void

  // -- Row selection ----------------------------------------------------------
  /** Enable row selection */
  enableRowSelection?: boolean
  /** Row selection state */
  rowSelection?: RowSelectionState
  /** Called when row selection changes */
  onRowSelectionChange?: (selection: RowSelectionState) => void

  // -- Column visibility -------------------------------------------------------
  /** Column visibility state */
  columnVisibility?: ColumnVisibilityState
  /** Called when column visibility changes */
  onColumnVisibilityChange?: (visibility: ColumnVisibilityState) => void

  // -- UI customization -------------------------------------------------------
  /** Show the bottom pagination controls (default: true) */
  showPagination?: boolean
  /** Page size options for the pagination dropdown */
  pageSizeOptions?: number[]
  /** Additional class names for the wrapper */
  className?: string
  /** Called when a row is clicked */
  onRowClick?: (row: TData) => void
  /** Whether data is loading */
  isLoading?: boolean
  /** Toolbar rendered above the table. Receives the table instance so you can
   *  build column visibility toggles, bulk actions, etc.
   *  Can also be a plain ReactNode if you don't need table access. */
  toolbar?:
    | React.ReactNode
    | ((table: DataTableInstance<TData>) => React.ReactNode)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** v9 hands change handlers an `Updater<T>`; these props take plain values. */
function resolveUpdater<T>(updater: Updater<T>, previous: T): T {
  return typeof updater === "function"
    ? (updater as (old: T) => T)(previous)
    : updater
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A reusable, feature-rich DataTable built on top of TanStack Table + shadcn/ui.
 *
 * Supports both **client-side** and **server-side** pagination, sorting, and filtering.
 *
 * ## Client-side usage (simplest — loads all data at once)
 *
 * ```tsx
 * <DataTable columns={columns} data={data} />
 * ```
 *
 * ## Server-side usage (paginate/sort/filter on the server)
 *
 * ```tsx
 * <DataTable
 *   columns={columns}
 *   data={products}
 *   pageCount={totalPages}
 *   pageIndex={page}
 *   pageSize={pageSize}
 *   onPageChange={setPage}
 *   onPageSizeChange={setPageSize}
 *   sorting={sorting}
 *   onSortingChange={setSorting}
 *   toolbar={<Input ... />}
 * />
 * ```
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  pageCount,
  pageIndex,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sorting: externalSorting,
  onSortingChange: externalOnSortingChange,
  columnFilters: externalColumnFilters,
  onColumnFiltersChange: externalOnColumnFiltersChange,
  enableRowSelection = false,
  rowSelection: externalRowSelection,
  onRowSelectionChange: externalOnRowSelectionChange,
  columnVisibility: externalColumnVisibility,
  onColumnVisibilityChange: externalOnColumnVisibilityChange,
  showPagination = true,
  pageSizeOptions,
  className,
  onRowClick,
  isLoading = false,
  toolbar,
}: DataTableProps<TData>) {
  // -- Internal state (used when no external state is provided) ---------------
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([])
  const [internalColumnFilters, setInternalColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [internalColumnVisibility, setInternalColumnVisibility] =
    React.useState<ColumnVisibilityState>({})
  const [internalRowSelection, setInternalRowSelection] =
    React.useState<RowSelectionState>({})

  // Decide between external (controlled) and internal state
  const sorting = externalSorting ?? internalSorting
  const columnFilters = externalColumnFilters ?? internalColumnFilters
  const columnVisibility = externalColumnVisibility ?? internalColumnVisibility
  const rowSelection = externalRowSelection ?? internalRowSelection

  const isServerSide = pageCount !== undefined

  // Build tanstack table options
  const tableOptions: TableOptions<DataTableFeatures, TData> = {
    features: dataTableFeatures,
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      ...(isServerSide && {
        pagination: {
          pageIndex: pageIndex ?? 0,
          pageSize: pageSize ?? 10,
        },
      }),
      // Client-side with the controls hidden means one page holding everything.
      // The paginated row model is registered for every table (see
      // `dataTableFeatures`), so without this tanstack's default page size would
      // quietly cut the table off at ten rows — with no controls on screen to
      // page past them.
      ...(!isServerSide &&
        !showPagination && {
          pagination: { pageIndex: 0, pageSize: Math.max(data.length, 1) },
        }),
    },
    enableRowSelection,

    // Sorting
    onSortingChange: (updater) => {
      const next = resolveUpdater(updater, sorting)
      ;(externalOnSortingChange ?? setInternalSorting)(next)
    },

    // Column filters
    onColumnFiltersChange: (updater) => {
      const next = resolveUpdater(updater, columnFilters)
      ;(externalOnColumnFiltersChange ?? setInternalColumnFilters)(next)
    },

    // Column visibility
    onColumnVisibilityChange: (updater) => {
      const next = resolveUpdater(updater, columnVisibility)
      ;(externalOnColumnVisibilityChange ?? setInternalColumnVisibility)(next)
    },

    // Row selection
    onRowSelectionChange: (updater) => {
      const next = resolveUpdater(updater, rowSelection)
      ;(externalOnRowSelectionChange ?? setInternalRowSelection)(next)
    },

    // Server-side vs client-side pagination/sorting/filtering
    ...(isServerSide
      ? {
          manualPagination: true,
          manualSorting: true,
          manualFiltering: true,
          pageCount,
          // The caller owns the page index (it lives in the URL), so leave
          // resetting it to them rather than fighting over it on every change.
          autoResetPageIndex: false,
          onPaginationChange: (updater: Updater<PaginationState>) => {
            const previous = {
              pageIndex: pageIndex ?? 0,
              pageSize: pageSize ?? 10,
            }
            const next = resolveUpdater(updater, previous)
            if (next.pageIndex !== previous.pageIndex) {
              onPageChange?.(next.pageIndex)
            }
            if (next.pageSize !== previous.pageSize) {
              onPageSizeChange?.(next.pageSize)
            }
          },
        }
      : {}),
  }

  const table = useTable(tableOptions)

  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {typeof toolbar === "function" ? toolbar(table) : toolbar}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder ? null : (
                      <FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <Spinner className="mx-auto size-5" />
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {showPagination && (
        <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
      )}
    </div>
  )
}
