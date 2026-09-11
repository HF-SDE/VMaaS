import { Suspense } from "react"
import { PERMISSIONS } from "../../../../shared/types/permissions"

import { requirePermission } from "@/lib/dal"
import { getProductsPaginated } from "@/lib/data/products"

import { productsErrorMessage } from "./messages"
import { ProductsDataTable } from "./products-table"
import Loader from "@/components/loader/loader"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default function ProductsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Static: prerendered into the shell. */}
      <h1 className="text-2xl font-bold">Produkter</h1>

      {/* Reads the session and the backend, so it streams in behind the boundary. */}
      <Suspense fallback={<Loader text="Indlæser produkter…" />}>
        <ProductsSection searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

/**
 * Renders the first page server-side so the table has rows on first paint;
 * every later page/sort/search goes through the `getProductsAction` server
 * action from the client component.
 */
async function ProductsSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { activeTenantId } = await requirePermission(PERMISSIONS.PRODUCT_READ)
  const params = await searchParams

  const page = Number(first(params.page) ?? 0)
  const pageSize = Number(first(params.size) ?? 10)

  const [error, initialData] = await getProductsPaginated(activeTenantId, {
    // The backend clamps out-of-range values, so a junk URL still renders.
    page: Number.isFinite(page) ? page : 0,
    pageSize: Number.isFinite(pageSize) ? pageSize : 10,
    sortBy: first(params.orderBy) ?? "createdAt",
    sortOrder: first(params.orderDir) === "asc" ? "asc" : "desc",
    search: first(params.q),
  })

  // A failed first page renders the message in place rather than throwing to
  // the error boundary — the rest of the page is still perfectly usable.
  if (error) {
    return <p className="text-destructive">{productsErrorMessage(error)}</p>
  }

  return <ProductsDataTable initialData={initialData} />
}
