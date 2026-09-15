import { Suspense } from "react"
import { PERMISSIONS } from "../../../shared/types/permissions"

import { getMachines, Machine } from "@/lib/data/machines"
import { requirePermission, requireTenant } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
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
    </div>
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
