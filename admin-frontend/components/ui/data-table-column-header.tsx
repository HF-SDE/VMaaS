"use client"

import type { Column, RowData } from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DataTableFeatures } from "@/components/data-table-generic"

interface DataTableColumnHeaderProps<TData extends RowData, TValue> {
  column: Column<DataTableFeatures, TData, TValue>
  title: string
  className?: string
}

/**
 * Header cell that toggles sorting when the column allows it.
 *
 * Under `manualSorting` the click only updates sorting state — the DataTable's
 * `onSortingChange` caller is what turns that into a refetch.
 */
export function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <span className={cn("text-sm font-medium", className)}>{title}</span>
  }

  const sorted = column.getIsSorted()

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-3 h-8 data-[state=open]:bg-accent", className)}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      <span>{title}</span>
      {sorted === "desc" ? (
        <ArrowDown className="ml-2 h-4 w-4" />
      ) : sorted === "asc" ? (
        <ArrowUp className="ml-2 h-4 w-4" />
      ) : (
        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
      )}
      <span className="sr-only">Sortér efter {title}</span>
    </Button>
  )
}
