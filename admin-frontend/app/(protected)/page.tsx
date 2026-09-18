import { Suspense } from "react"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import {
  DEFAULT_SALES_MAP_DAYS,
  type SaleMapPoint,
} from "@vmaas/shared/types/sale"

import { getMachines, Machine } from "@/lib/data/machines"
import { requirePermission, requireTenant } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import { fetchData } from "@/lib/data/data-fetch"
import { SalesMapCluster } from "./components/sales-map-cluster"
import { ErrorToast } from "./error-toast"

// The tenant gate below reads the session, which cannot be prerendered into the
// static shell. Same opt-out the other session-gated pages use.
export const instant = false

export default async function DashboardPage() {
  // Login lands here, so this is where a brand new account has to be sent on to
  // /welcome to create its first tenant. Gating before the shell renders makes
  // that a real redirect instead of a dashboard that flashes and then moves.
  // The per-permission gate stays on the read below, so someone who has a tenant
  // but no machine access still gets the page rather than a denial.
  await requireTenant()

  return (
    <div>
      <h1 className="text-2xl font-bold">Overview</h1>

      <Suspense fallback={<p>Loading machines…</p>}>
        <MachineList />
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
        Sales · last {DEFAULT_SALES_MAP_DAYS} days
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Every sale where it was rung up. Each circle shows how many sales it
        holds and what they earned.
      </p>
      {error ? (
        <ErrorToast message={error.reason} />
      ) : (
        <SalesMapCluster sales={sales} />
      )}
    </section>
  )
}

const NO_READ_ACCESS = "You do not have access to machines."

async function MachineList() {
  // Gate first, then the read — never the other way around. This is also what
  // sends a user with no active tenant to /welcome: login lands here, so
  // without this call a brand new account would sit on an empty dashboard with
  // no way to reach the tenant it still has to create.
  await requirePermission(PERMISSIONS.MACHINE_READ, NO_READ_ACCESS)

  const [error, machines] = await fetchData<Machine[]>("/api/machines")
  if (error) return <ErrorToast message={error.reason} />

  return (
    <ul>
      {machines.map((machine) => (
        <li key={machine.id}>
          {machine.name}
          {` — ${machine.site.name}`}
        </li>
      ))}
    </ul>
  )
}
