"use client"

import type { RowData } from "@tanstack/react-table"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// Type-only, so it is erased at compile time and creates no runtime import
// cycle with data-table-generic, which imports this component for its value.
import type { DataTableInstance } from "./data-table-generic"

interface DataTablePaginationProps<TData extends RowData> {
  table: DataTableInstance<TData>
  pageSizeOptions?: number[]
}

/**
 * Reusable pagination controls for the DataTable.
 *
 * Supports:
 * - Page size selector
 * - First / previous / next / last page buttons
 * - Current page indicator
 *
 * Works with both client-side (`paginatedRowModel`) and
 * server-side (manual) pagination via `manualPagination: true`.
 *
 * Typed against `DataTableFeatures` rather than a bare feature generic: v9
 * types are invariant in `TFeatures`, so the pagination, selection and
 * filtering APIs read below are only present on tables built from that exact
 * feature set.
 */
export function DataTablePagination<TData extends RowData>({
  table,
  pageSizeOptions = [10, 20, 30, 50],
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.state.pagination
  const selectedRows = table.getFilteredSelectedRowModel().rows.length
  const filteredRows = table.getFilteredRowModel().rows.length

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-2">
      <div className="min-h-5 flex-1 text-sm text-muted-foreground">
        {selectedRows > 0 && (
          <>
            {selectedRows} af {filteredRows} række(r) valgt.
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-4 lg:gap-8">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Rækker pr. side</p>
          <Select
            value={`${pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value))
            }}
            items={pageSizeOptions.map((option) => ({
              label: `${option}`,
              value: `${option}`,
            }))}
          >
            <SelectTrigger size="sm" className="w-17.5">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={`${option}`}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-center text-sm font-medium sm:w-25">
          Side {pageIndex + 1} af {table.getPageCount()}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Gå til første side</span>
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Gå til forrige side</span>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Gå til næste side</span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Gå til sidste side</span>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
