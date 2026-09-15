import { Suspense } from "react"
import { PERMISSIONS } from "../../../shared/types/permissions"

import { getMachines, Machine } from "@/lib/data/machines"
import { requirePermission } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { ErrorToast } from "./error-toast"

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Overview</h1>

      <Suspense fallback={<p>Loading machines…</p>}>
        <MachineList />
      </Suspense>
    </div>
  )
}

async function MachineList() {
  // Gate first, then the read — never the other way around.
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
