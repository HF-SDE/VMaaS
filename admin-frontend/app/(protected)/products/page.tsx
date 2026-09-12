import { ProductsDataTable } from "./products-table"
import { Suspense } from "react"
import Loader from "@/components/loader/loader"
import Link from "next/link"
import { RoleGate } from "@/components/role-gate"
import { Button } from "@/components/ui/button"
import { getProductsPaginated } from "@/lib/data/products"
import { requirePermission } from "@/lib/dal"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

const NO_READ_ACCESS = "Du har ikke adgang til produkter."

// TODO: this was edited on 21/03/2026 to add server-side data fetching for the initial table render.
// I'm not sure if this even helps with performance so maybe we should remove it again?
async function ProductsTableLoader({
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
  const session = await requirePermission(
    PERMISSIONS.PRODUCT_READ,
    NO_READ_ACCESS
  )
  const { activeTenantId } = session
  const [, initialData] = await getProductsPaginated(activeTenantId, {
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
  })

  return <ProductsDataTable initialData={initialData ?? undefined} />
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <div className="container mx-auto py-10">
      <div className="flex w-full justify-between">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Produkter</h1>
          <p className="text-muted-foreground">
            Oversigt over alle produkter i systemet.
          </p>
        </div>
        {/* Hiding one button must not redirect the whole page away. */}
        <Suspense>
          <RoleGate perms={[PERMISSIONS.PRODUCT_WRITE]} performRedirect={false}>
            <Button
              nativeButton={false}
              size="lg"
              render={<Link href="/produkter/opret" />}
            >
              Opret produkt
            </Button>
          </RoleGate>
        </Suspense>
      </div>
      <Suspense fallback={<Loader />}>
        <RoleGate perms={[PERMISSIONS.PRODUCT_READ]} reason={NO_READ_ACCESS}>
          <ProductsTableLoader searchParams={searchParams} />
        </RoleGate>
      </Suspense>
    </div>
  )
}
