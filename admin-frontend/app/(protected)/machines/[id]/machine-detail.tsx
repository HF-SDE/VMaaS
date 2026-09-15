import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import testData from "./test-data.json"
import { RoleGate } from "@/components/role-gate"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { requirePermission } from "@/lib/dal"
import { formatDate } from "@/lib/utils"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { machinesErrorMessage } from "../messages"
import { MachineActions } from "./machine-actions"
import { fetchData } from "@/lib/data/data-fetch"
import type { MachineDetail } from "../form"
import { STATUS_LABEL, STATUS_VARIANT } from "../status"
import { StockGrid } from "./stock-row-grid"
import { VendingMachine } from "./vending-machine"

export const NO_READ_ACCESS = "You do not have access to machines."

/**
 * Reads one machine and renders it.
 *
 * The permission is re-checked here rather than trusted from the <RoleGate>
 * around it: the gate decides what to render, this is what guards the data. The
 * tenant comes from that gate and never from the URL, so a machine id from
 * another tenant reads as 404.
 */
export async function MachineDetailLoader({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requirePermission(PERMISSIONS.MACHINE_READ, NO_READ_ACCESS)

  const [error, machine] = await fetchData<MachineDetail>(`/api/machines/${id}`)

  if (error) {
    // Branching on the status rather than on `reason`: the fetch layer fills
    // `reason` with the raw HTTP status text, not a tagged code.
    if (error.status === 404) notFound()

    return (
      <p role="alert" className="text-sm text-destructive">
        {machinesErrorMessage(error.status)}
      </p>
    )
  }

  const site = machine.site

  return (
    <>
      {/* Same title row as the machines list, with the edit/delete triggers
          where that page puts its "New machine" dialog. */}
      <div className="flex w-full justify-between">
        <div className="mb-6">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            {machine.name}
            <Badge variant={STATUS_VARIANT[machine.status]}>
              {STATUS_LABEL[machine.status]}
            </Badge>
          </h1>
          <p className="text-muted-foreground">
            {`Placed at ${site.name} — created ${formatDate(machine.createdAt)}`}
          </p>
        </div>
        {/* Hiding the buttons for a read-only user must not take the page away,
            hence performRedirect={false}. */}
        <Suspense>
          <RoleGate perms={[PERMISSIONS.MACHINE_WRITE]} performRedirect={false}>
            <MachineActions
              id={machine.id}
              name={machine.name}
              site={{ id: site.id, name: site.name }}
              canDelete={machine.canDelete}
            />
          </RoleGate>
        </Suspense>
      </div>

      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Site</dt>
              <dd>
                <Link href={`/sites/${site.id}`} className="hover:underline">
                  {site.name}
                </Link>
                {site.city && (
                  <span className="text-muted-foreground"> — {site.city}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Created</dt>
              <dd>{formatDate(machine.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Status</dt>
              <dd>{STATUS_LABEL[machine.status]}</dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">ID</dt>
              <dd className="font-mono text-xs text-muted-foreground">
                {machine.id}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <VendingMachine>
        <StockGrid
          stockRows={testData.map(({ beginX, beginY, endX, endY, ...row }) => ({
            ...row,
            x_start: beginX,
            y_start: beginY,
            x_end: endX,
            y_end: endY,
          }))}
        />
      </VendingMachine>
    </>
  )
}
