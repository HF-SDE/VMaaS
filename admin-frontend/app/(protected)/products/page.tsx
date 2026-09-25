import { ProductsDataTable } from "./products-table"
import { Suspense } from "react"
import Loader from "@/components/loader/loader"
import Link from "next/link"
import { RoleGate } from "@/components/role-gate"
import { Button } from "@/components/ui/button"
import { requirePermission } from "@/lib/dal"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import { NewProductDialog } from "./new-product-dialog"
import { fetchData } from "@/lib/data/data-fetch"
import { GetPaginatedResult } from "@vmaas/shared/types/data-table"
import { Product } from "@prisma"

const NO_READ_ACCESS = "Du har ikke adgang til produkter."

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
  // Archived products stay out of the list unless the toolbar toggle asks for them.
  const includeArchived = params?.["archived"] === "1"
  // Re-checked here, not just in the <RoleGate> above: the gate decides what to
  // render, this is what actually guards the data.
  const session = await requirePermission(
    PERMISSIONS.PRODUCT_READ,
    NO_READ_ACCESS
  )
  const { activeTenantId } = session

  const [error, initialData] = await fetchData<GetPaginatedResult<Product>>(
    "/api/products/paginated",
    {
      // Listed field by field rather than spread: an object literal is what makes
      // this assignable to the `query` record, and it keeps the wire names visible.
      query: {
        page: page,
        pageSize: pageSize,
        sortBy: sortBy,
        sortOrder: sortOrder,
        search: search,
        includeArchived: includeArchived,
      },
    }
  )

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
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">
            Overview of all products in the system.
          </p>
        </div>
        {/* Hiding one button must not redirect the whole page away. */}
        <Suspense>
          <RoleGate perms={[PERMISSIONS.PRODUCT_WRITE]} performRedirect={false}>
            <NewProductDialog />
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
