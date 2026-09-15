import { Suspense } from "react"
import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { requirePermission } from "@/lib/dal"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import { NewMachineDialog } from "./new-machine-dialog"
import { fetchData } from "@/lib/data/data-fetch"
import { GetPaginatedResult } from "@vmaas/shared/types/data-table"
import type { MachineListItem } from "./form"
import { MachinesDataTable } from "./machines-table"

const NO_READ_ACCESS = "You do not have access to machines."

// TODO: this was edited on 21/03/2026 to add server-side data fetching for the initial table render.
// I'm not sure if this even helps with performance so maybe we should remove it again?
async function MachinesTableLoader({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const page = Number(params?.["page"] ?? "0")
  const pageSize = Number(params?.["size"] ?? "10")
  const sortBy = (params?.["orderBy"] as string | undefined) ?? "createdAt"
  const sortOrder = ((params?.["orderDir"] as string | undefined) ?? "asc") as
    "asc" | "desc"
  const search = (params?.["q"] as string | undefined) ?? ""
  // Re-checked here, not just in the <RoleGate> above: the gate decides what to
  // render, this is what actually guards the data.
  await requirePermission(PERMISSIONS.MACHINE_READ, NO_READ_ACCESS)
  const [, initialData] = await fetchData<GetPaginatedResult<MachineListItem>>(
    "/api/machines/paginated",
    {
      // Listed field by field rather than spread: an object literal is what makes
      // this assignable to the `query` record, and it keeps the wire names visible.
      query: {
        page: page,
        pageSize: pageSize,
        sortBy: sortBy,
        sortOrder: sortOrder,
        search: search,
      },
    }
  )

  return <MachinesDataTable initialData={initialData ?? undefined} />
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <div className="container mx-auto py-10">
      <div className="flex w-full justify-between">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Machines</h1>
          <p className="text-muted-foreground">
            Overview of all machines in the system.
          </p>
        </div>
        {/* Hiding one button must not redirect the whole page away. */}
        <Suspense>
          <RoleGate perms={[PERMISSIONS.MACHINE_WRITE]} performRedirect={false}>
            <NewMachineDialog />
          </RoleGate>
        </Suspense>
      </div>
      <Suspense fallback={<Loader />}>
        <RoleGate perms={[PERMISSIONS.MACHINE_READ]} reason={NO_READ_ACCESS}>
          <MachinesTableLoader searchParams={searchParams} />
        </RoleGate>
      </Suspense>
    </div>
  )
}
