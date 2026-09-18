import { Suspense } from "react"
import { notFound } from "next/navigation"
import { RoleGate } from "@/components/role-gate"
import { Badge } from "@/components/ui/badge"
import { requirePermission } from "@/lib/dal"
import { formatDate } from "@/lib/utils"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { machinesErrorMessage } from "../messages"
import { MachineCards } from "./cards/card-container"
import { MachineActions } from "./machine-actions"
import { fetchData } from "@/lib/data/data-fetch"
import type { MachineDetail } from "../form"
import { STATUS_LABEL, STATUS_VARIANT } from "../status"
import type { SlotListItem } from "./slot-columns"
import { SlotsTable } from "./slots-table"
import { StockGrid } from "./stock-row-grid"
import { VendingMachine } from "./vending-machine"
import { VendingMachineSlim } from "./vending-machine-slim"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

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

  // Together rather than one after the other: the slots belong to the same
  // machine and neither read depends on the other's answer.
  const [[error, machine], [slotsError, slots]] = await Promise.all([
    fetchData<MachineDetail>(`/api/machines/${id}`),
    fetchData<SlotListItem[]>("/api/slots", { query: { machineId: id } }),
  ])

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
      {/* Full width, not the 400px the tabs shipped with: the KPI row below
          needs four columns to lay out on a wide screen. */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          {/* The KPI block rides along with the machine — no second request,
              so the cards cannot show a different machine than the panel. */}
          <MachineCards machine={machine} />

          {/* A failed slot read costs the table, not the page: the machine and
              its cards are already here and still worth showing. */}
          {slotsError ? (
            <p role="alert" className="text-sm text-destructive">
              {machinesErrorMessage(slotsError.status)}
            </p>
          ) : (
            <SlotsTable slots={slots} />
          )}
        </TabsContent>
        <TabsContent value="preview">
          {/* The same read the table above uses — the preview is a second view
              of those slots, not a second request. */}
          {slotsError ? (
            <p role="alert" className="text-sm text-destructive">
              {machinesErrorMessage(slotsError.status)}
            </p>
          ) : (
            <>
              {/* The full cabinet needs room for its keypad column; below md
                  only the display window fits, so the slim shell stands in. */}
              <VendingMachineSlim
                className="md:hidden"
                label={machine.name}
                status={STATUS_LABEL[machine.status]}
              >
                <StockGrid slots={slots} />
              </VendingMachineSlim>
              <VendingMachine
                className="hidden md:block"
                label={machine.name}
                status={STATUS_LABEL[machine.status]}
              >
                <StockGrid slots={slots} />
              </VendingMachine>
            </>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
