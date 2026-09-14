import { SitesDataTable } from "./sites-table"
import { Suspense } from "react"
import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { requirePermission } from "@/lib/dal"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import { NewSiteDialog } from "./new-site-dialog"
import { fetchData } from "@/lib/data/data-fetch"
import { GetPaginatedResult } from "@vmaas/shared/types/data-table"
import { Site } from "@prisma"

const NO_READ_ACCESS = "You do not have access to sites."

async function SitesTableLoader({
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
  await requirePermission(PERMISSIONS.SITE_READ, NO_READ_ACCESS)

  // The failure is dropped on purpose: this read only primes the table's first
  // render, and the table refetches on mount when it arrives without data —
  // that path already words the error and toasts it.
  const [, initialData] = await fetchData<GetPaginatedResult<Site>>(
    "/api/sites/paginated",
    {
      // Listed field by field rather than spread: an object literal is what
      // makes this assignable to the `query` record, and it keeps the wire
      // names visible.
      query: {
        page: page,
        pageSize: pageSize,
        sortBy: sortBy,
        sortOrder: sortOrder,
        search: search,
      },
    }
  )

  return <SitesDataTable initialData={initialData ?? undefined} />
}

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <div className="container mx-auto py-10">
      <div className="flex w-full justify-between">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Sites</h1>
          <p className="text-muted-foreground">
            Overview of all sites in the system.
          </p>
        </div>
        {/* Hiding one button must not redirect the whole page away. */}
        <Suspense>
          <RoleGate perms={[PERMISSIONS.SITE_WRITE]} performRedirect={false}>
            <NewSiteDialog />
          </RoleGate>
        </Suspense>
      </div>
      <Suspense fallback={<Loader />}>
        <RoleGate perms={[PERMISSIONS.SITE_READ]} reason={NO_READ_ACCESS}>
          <SitesTableLoader searchParams={searchParams} />
        </RoleGate>
      </Suspense>
    </div>
  )
}
