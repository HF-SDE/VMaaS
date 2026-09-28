"use client"

import { Filter, Loader2, Search } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Accordion } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDebounce } from "@/hooks/use-debounce"
import { getAlertsPage } from "@/lib/data/alerts"
import type { MachineAlertRow } from "@vmaas/shared/types/machineAlert"

import { AlertRow } from "./alert-row"
import { EMPTY_FILTERS, type Filters, activeFilterCount } from "./alert-types"
import { FilterPanel } from "./filter-panel"
import { useAlertsWs } from "@/hooks/use-ws"

const PAGE_SIZE = 50

export function MachineAlertLogs() {
  const [alerts, setAlerts] = useState<MachineAlertRow[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [searchQuery, setSearchQuery] = useState("")

  useAlertsWs(({ body }) => setAlerts((prev) => [body, ...prev]))

  const debouncedSearch = useDebounce(searchQuery, 300)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const fetchAlerts = useCallback(
    async (page: number, search: string, f: Filters, append: boolean) => {
      setLoading(true)
      try {
        const [error, value] = await getAlertsPage({
          page,
          pageSize: PAGE_SIZE,
          search: search || undefined,
          machineIds: f.machineIds,
          siteIds: f.siteIds,
          alertTypes: f.alertTypes,
          dateFrom: f.dateFrom ?? undefined,
          dateTo: f.dateTo ?? undefined,
        })
        // Stop paging: with `hasMore` still true the visible sentinel would
        // refire the request every time `loading` settles, forever.
        if (error) {
          setHasMore(false)
          return
        }

        setAlerts((prev) => (append ? [...prev, ...value.data] : value.data))
        // The endpoint answers `pageCount`, not `hasMore` — a page past the last
        // one is the end of the log.
        setHasMore(value.page + 1 < value.pageCount)
        setTotalCount(value.totalCount)
        setCurrentPage(value.page)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Search or filters changed: drop what is loaded and start again at page 0.
  useEffect(() => {
    setAlerts([])
    setCurrentPage(0)
    setHasMore(true)
    fetchAlerts(0, debouncedSearch, filters, false)
  }, [debouncedSearch, filters, fetchAlerts])

  // Infinite scroll.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          fetchAlerts(currentPage + 1, debouncedSearch, filters, true)
        }
      },
      { threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, currentPage, debouncedSearch, filters, fetchAlerts])

  const filterCount = activeFilterCount(filters)

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by message, machine or site..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
          className="relative"
          aria-label="Toggle filters"
        >
          <Filter className="h-4 w-4" />
          {filterCount > 0 && (
            <Badge className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center bg-destructive p-0 text-xs">
              {filterCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card md:flex-row">
        {showFilters && (
          <div className="overflow-hidden border-b border-border md:w-72 md:shrink-0 md:border-r md:border-b-0">
            <FilterPanel filters={filters} onChange={setFilters} />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Column headers. The leading spacer and the trailing 2rem line the
              labels up with the row grid, which the accordion chevron offsets. */}
          <div className="hidden items-center gap-4 border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:grid md:grid-cols-[7rem_10rem_minmax(0,1fr)_minmax(0,1fr)_5rem_2rem]">
            <span>Type</span>
            <span>Occurred</span>
            <span>Machine</span>
            <span>Site</span>
            <span className="text-right">Status</span>
            <span />
          </div>

          {alerts.length > 0 ? (
            <Accordion>
              {alerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </Accordion>
          ) : (
            !loading && (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">
                  No alerts match your search.
                </p>
              </div>
            )
          )}

          <div ref={sentinelRef} className="h-1 w-full" />

          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!hasMore && alerts.length > 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              All {totalCount} alerts loaded.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
