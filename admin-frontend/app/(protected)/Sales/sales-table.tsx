"use client"

import * as React from "react"
import type { ColumnVisibilityState, SortingState } from "@tanstack/react-table"
import { CalendarIcon, Search, Settings2, X } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { endOfDay, format, startOfDay } from "date-fns"
import { da } from "date-fns/locale"
import type { sale_status } from "@prisma"

import {
  DataTable,
  type DataTableInstance,
} from "@/components/data-table-generic"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatPrice } from "@/lib/utils"
import { SalesResponse } from "@/types/responses"

import { salesColumnNames, salesColumns } from "./columns"
import { SALE_STATUS_LABEL } from "./status"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMN_VISIBILITY_KEY = "sales-table:column-visibility"

const DEFAULT_COLUMN_VISIBILITY: ColumnVisibilityState = {
  completedAt: false,
  id: false,
}

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }]

/** Sentinel for "no filter" — base-ui's Select treats `null` as unselected. */
const ALL = "all"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readColumnVisibility(): ColumnVisibilityState {
  if (typeof window === "undefined") return DEFAULT_COLUMN_VISIBILITY
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY)
    return raw
      ? (JSON.parse(raw) as ColumnVisibilityState)
      : DEFAULT_COLUMN_VISIBILITY
  } catch {
    return DEFAULT_COLUMN_VISIBILITY
  }
}

function writeColumnVisibility(state: ColumnVisibilityState) {
  try {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(state))
  } catch {
    // ignore quota / SSR errors
  }
}

/** Unique `{ value, label }` options, sorted by label. */
function uniqueOptions(entries: { value: string; label: string }[]) {
  const map = new Map(entries.map((entry) => [entry.value, entry]))
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------------------
// Filter select
// ---------------------------------------------------------------------------

function FilterSelect({
  placeholder,
  value,
  options,
  onChange,
}: {
  placeholder: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const items = [{ value: ALL, label: placeholder }, ...options]

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onChange(next ?? ALL)}
    >
      <SelectTrigger size="sm" className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sales history table. The sales endpoint returns every sale for the tenant, so
 * filtering and sorting happen in the browser: filters narrow `data` up front
 * (so the summary cards reflect them), and the DataTable sorts and paginates
 * what is left.
 */
export function SalesDataTable({ sales }: { sales: SalesResponse[] }) {
  // -- Filters ----------------------------------------------------------------
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState<string>(ALL)
  const [machineId, setMachineId] = React.useState<string>(ALL)
  const [siteId, setSiteId] = React.useState<string>(ALL)
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>()

  const hasFilters =
    search !== "" ||
    status !== ALL ||
    machineId !== ALL ||
    siteId !== ALL ||
    dateRange?.from !== undefined

  const resetFilters = () => {
    setSearch("")
    setStatus(ALL)
    setMachineId(ALL)
    setSiteId(ALL)
    setDateRange(undefined)
  }

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

  const [sorting, setSorting] = React.useState<SortingState>(DEFAULT_SORTING)

  // -- Filter options, derived from the sales themselves --------------------
  const statusOptions = React.useMemo(
    () =>
      (Object.keys(SALE_STATUS_LABEL) as sale_status[]).map((value) => ({
        value,
        label: SALE_STATUS_LABEL[value],
      })),
    []
  )
  const machineOptions = React.useMemo(
    () =>
      uniqueOptions(
        sales
          .filter((sale) => siteId === ALL || sale.machine.siteId === siteId)
          .map((sale) => ({ value: sale.machine.id, label: sale.machine.name }))
      ),
    [sales, siteId]
  )
  const siteOptions = React.useMemo(
    () =>
      uniqueOptions(
        sales.map((sale) => ({
          value: sale.machine.site.id,
          label: sale.machine.site.name,
        }))
      ),
    [sales]
  )

  // -- Filtered data ----------------------------------------------------------
  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    // The calendar gives local midnights; `to` is inclusive of the whole day,
    // and a single picked day (no `to` yet) filters to just that day.
    const fromTime = dateRange?.from
      ? startOfDay(dateRange.from).getTime()
      : -Infinity
    const toDay = dateRange?.to ?? dateRange?.from
    const toTime = toDay ? endOfDay(toDay).getTime() : Infinity

    return sales.filter((sale) => {
      if (status !== ALL && sale.status !== status) return false
      if (machineId !== ALL && sale.machine.id !== machineId) return false
      if (siteId !== ALL && sale.machine.site.id !== siteId) return false

      const created = new Date(sale.createdAt).getTime()
      if (created < fromTime || created > toTime) return false

      if (query) {
        const haystack = [
          sale.product?.name,
          sale.machine.name,
          sale.machine.site.name,
          sale.id,
        ]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [sales, search, status, machineId, siteId, dateRange])

  // -- Summary ----------------------------------------------------------------
  const summary = React.useMemo(() => {
    const completed = filtered.filter((sale) => sale.status === "completed")
    const revenue = completed.reduce((sum, sale) => sum + Number(sale.price), 0)
    const refunded = filtered.filter((sale) => sale.status === "refunded")
    return {
      count: filtered.length,
      completedCount: completed.length,
      revenue,
      average: completed.length ? revenue / completed.length : 0,
      refundedCount: refunded.length,
      refundedAmount: refunded.reduce((sum, s) => sum + Number(s.price), 0),
    }
  }, [filtered])

  // -- Toolbar ----------------------------------------------------------------
  const toolbar = (table: DataTableInstance<SalesResponse>) => (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:max-w-xs">
        <Search className="absolute top-2 left-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search product, machine, site..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-8"
        />
      </div>

      <FilterSelect
        placeholder="All statuses"
        value={status}
        options={statusOptions}
        onChange={setStatus}
      />
      <FilterSelect
        placeholder="All sites"
        value={siteId}
        options={siteOptions}
        onChange={(value) => {
          setSiteId(value)
          // A machine from another site would leave the table silently empty.
          setMachineId(ALL)
        }}
      />
      <FilterSelect
        placeholder="All machines"
        value={machineId}
        options={machineOptions}
        onChange={setMachineId}
      />

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8" onClick={resetFilters}>
          Reset
          <X className="ml-1 h-4 w-4" />
        </Button>
      )}

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
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {salesColumnNames[column.id] || column.id}
              </DropdownMenuCheckboxItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Revenue"
          value={formatPrice(summary.revenue)}
          hint={`${summary.completedCount} completed sale${summary.completedCount !== 1 ? "s" : ""}`}
        />
        <SummaryCard
          label="Transactions"
          value={summary.count.toLocaleString("da-DK")}
          hint={hasFilters ? `of ${sales.length} total` : "All time"}
        />
        <SummaryCard
          label="Average sale"
          value={formatPrice(summary.average)}
          hint="Completed sales only"
        />
        <SummaryCard
          label="Refunded"
          value={formatPrice(summary.refundedAmount)}
          hint={`${summary.refundedCount} refund${summary.refundedCount !== 1 ? "s" : ""}`}
        />
      </div>

      <DataTable
        columns={salesColumns}
        data={filtered}
        sorting={sorting}
        onSortingChange={setSorting}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        pageSizeOptions={[10, 25, 50, 100]}
        toolbar={toolbar}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {value}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
    </Card>
  )
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange | undefined
  onChange: (range: DateRange | undefined) => void
}) {
  const label = value?.from
    ? value.to && value.to.getTime() !== value.from.getTime()
      ? `${format(value.from, "d. MMM yyyy", { locale: da })} – ${format(value.to, "d. MMM yyyy", { locale: da })}`
      : format(value.from, "d. MMM yyyy", { locale: da })
    : "Pick a date range"

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 justify-start font-normal data-[empty=true]:text-muted-foreground"
            data-empty={!value?.from}
          />
        }
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {label}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={value?.from}
          selected={value}
          onSelect={onChange}
          disabled={{ after: new Date() }}
          weekStartsOn={1}
        />
      </PopoverContent>
    </Popover>
  )
}
