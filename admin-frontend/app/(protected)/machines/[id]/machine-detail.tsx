import { Suspense } from "react"
import { notFound } from "next/navigation"

import { RoleGate } from "@/components/role-gate"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requirePermission } from "@/lib/dal"
import { formatDate } from "@/lib/utils"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { machinesErrorMessage } from "../messages"
import { MachineActions } from "./machine-actions"
import { fetchData } from "@/lib/data/data-fetch"
import type { MachineDetail } from "../form"

export const NO_READ_ACCESS = "You do not have access to machines."

/** `machine_status` is reported by the firmware, so it is shown, never edited. */
const STATUS_VARIANT: Record<
  MachineDetail["status"],
  "default" | "secondary" | "destructive"
> = {
  online: "default",
  offline: "secondary",
  error: "destructive",
}

const STATUS_LABEL: Record<MachineDetail["status"], string> = {
  online: "Online",
  offline: "Offline",
  error: "Error",
}

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

  // Bound to a local so its narrowing survives into the JSX below.
  const location = machine.location

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-2xl">
          {machine.name}
          <Badge variant={STATUS_VARIANT[machine.status]}>
            {STATUS_LABEL[machine.status]}
          </Badge>
        </CardTitle>
        <CardDescription>
          {location !== null
            ? `Placed at ${location} — created ${formatDate(machine.createdAt)}`
            : "Not placed yet — created " + formatDate(machine.createdAt)}
        </CardDescription>

        {/* Hiding the buttons for a read-only user must not take the page away,
            hence performRedirect={false}. */}
        <CardAction>
          <Suspense>
            <RoleGate
              perms={[PERMISSIONS.MACHINE_WRITE]}
              performRedirect={false}
            >
              <MachineActions
                id={machine.id}
                name={machine.name}
                location={location}
                canDelete={machine.canDelete}
              />
            </RoleGate>
          </Suspense>
        </CardAction>
      </CardHeader>

      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Location</dt>
            <dd>{location ?? "—"}</dd>
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
  )
}
