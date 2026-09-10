import { Suspense } from "react"
import { PERMISSIONS } from "../../../shared/types/permissions"

import { getMachines } from "@/lib/data/machines"
import { requirePermission } from "@/lib/dal"

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Oversigt</h1>

      <Suspense fallback={<p>Indlæser maskiner…</p>}>
        <MachineList />
      </Suspense>
    </div>
  )
}

async function MachineList() {
  // Gate first, then the read — never the other way around.
  const { activeTenantId } = await requirePermission(PERMISSIONS.MACHINE_READ)
  const machines = await getMachines(activeTenantId)

  if (machines.length === 0) return <p>Ingen maskiner endnu.</p>

  return (
    <ul>
      {machines.map((machine) => (
        <li key={machine.id}>
          {machine.name}
          {machine.location ? ` — ${machine.location}` : ""}
        </li>
      ))}
    </ul>
  )
}
