import { Suspense } from "react"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import {
  DEFAULT_SALES_MAP_DAYS,
  type SaleMapPoint,
} from "@vmaas/shared/types/sale"

import { requireTenant } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import { fetchData } from "@/lib/data/data-fetch"
import { KpiCards } from "./components/kpi-cards"
import { NeedsAttentionSection } from "./components/needs-attention"
import { RestockQueueSection } from "./components/restock-queue"
import { SalesMapCluster } from "./components/sales-map-cluster"
import { SalesSummarySection } from "./components/sales-summary"
import { SectionError } from "./components/section-error"

// The tenant gate below reads the session, which cannot be prerendered into the
// static shell. Same opt-out the other session-gated pages use.
export const instant = false

/**
 * Problems first, money second: the sections are ordered by how urgent acting on
 * them is, and each one is permission-gated on its own, so what a user sees is
 * composed from what they may see rather than chosen by role.
 *
 * Each section sits in its own <Suspense> and reports its own failure inline, so
 * one dead endpoint costs one card rather than the page.
 */
export default async function DashboardPage() {
  await requireTenant()

  return (
    <div>
      <h1 className="text-2xl font-bold">Overview</h1>

      {/* The figures first: the whole state of the tenant in one row, before
          any of the queues below ask for a click. */}
      <div className="mt-8">
        <Suspense fallback={<p>Loading key figures…</p>}>
          <KpiCards />
        </Suspense>
      </div>

      {/* Two queues of things to act on — side by side from md up, stacked on
          a phone. */}
      <div className="mt-8 grid items-start gap-8 md:grid-cols-2">
        <Suspense fallback={<p>Loading alerts…</p>}>
          <NeedsAttentionSection />
        </Suspense>

        <Suspense fallback={<p>Loading the restock queue…</p>}>
          <RestockQueueSection />
        </Suspense>
      </div>

      <Suspense fallback={<p>Loading sales…</p>}>
        <SalesSummarySection />
      </Suspense>

      <Suspense fallback={<p>Loading the sales map…</p>}>
        <SalesMapSection />
      </Suspense>
    </div>
  )
}

/**
 * The heading lives in here with the map so that a user without sales access
 * loses the whole section rather than being left with a title over nothing.
 *
 * `hasPermission` rather than `requirePermission`: this is one section of a
 * dashboard, and a redirect would take the machine list away from someone whose
 * only missing permission is sales.
 */
async function SalesMapSection() {
  const session = await requireTenant()
  if (!hasPermission(session, PERMISSIONS.SALE_READ)) return null

  // No `days` param: the endpoint's own default window is what the heading
  // names, so passing it here would be two places to change it.
  const [error, sales] = await fetchData<SaleMapPoint[]>("/api/sales/map")

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">
        Sales map · last {DEFAULT_SALES_MAP_DAYS} days
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Every sale where it was rung up. Each circle shows how many sales it
        holds and what they earned.
      </p>
      {error ? (
        <SectionError message="Couldn't load the sales map." />
      ) : (
        <SalesMapCluster sales={sales} />
      )}
    </section>
  )
}
