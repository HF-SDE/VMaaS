import { Suspense } from "react"
import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { requirePermission } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { SalesResponse } from "@/types/responses"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { SalesDataTable } from "./sales-table"

const NO_READ_ACCESS = "You do not have access to sales."

async function SalesTableLoader() {
  // Re-checked here, not just in the <RoleGate> above: the gate decides what to
  // render, this is what actually guards the data.
  await requirePermission(PERMISSIONS.SALE_READ, NO_READ_ACCESS)

  const [err, sales] = await fetchData<SalesResponse[]>("/api/sales")

  if (err) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load sales: {err.reason}
      </p>
    )
  }

  return <SalesDataTable sales={sales} />
}

export default function SalesPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Sales</h1>
        <p className="text-muted-foreground">
          History of every sale across your machines.
        </p>
      </div>
      <Suspense fallback={<Loader />}>
        <RoleGate perms={[PERMISSIONS.SALE_READ]} reason={NO_READ_ACCESS}>
          <SalesTableLoader />
        </RoleGate>
      </Suspense>
    </div>
  )
}
