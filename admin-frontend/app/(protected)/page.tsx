import { Suspense } from "react"
import { PERMISSIONS } from "../../../shared/types/permissions"

import { getMachines, Machine } from "@/lib/data/machines"
import { requirePermission } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { toast } from "sonner"

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
  const [error, machines] = await fetchData<Machine[]>("/api/machines")
  if (error) {
    toast.error("An error occurred while fetching machines.", {
      duration: 20_000,
    })
    return null
  }

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
