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
import { formatDate, formatPrice } from "@/lib/utils"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { productsErrorMessage } from "../messages"
import { ProductActions } from "./product-actions"
import { fetchData } from "@/lib/data/data-fetch"
import { ProductDetail } from "@vmaas/shared/types/product"

export const NO_READ_ACCESS = "Du har ikke adgang til produkter."

/**
 * Reads one product and renders it.
 *
 * The permission is re-checked here rather than trusted from the <RoleGate>
 * around it: the gate decides what to render, this is what guards the data. The
 * tenant comes from that gate and never from the URL, so a product id from
 * another tenant reads as 404.
 */
export async function ProductDetailLoader({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { activeTenantId } = await requirePermission(
    PERMISSIONS.PRODUCT_READ,
    NO_READ_ACCESS
  )

  const [error, product] = await fetchData<ProductDetail>(`/api/products/${id}`)
  console.log("🚀 ~ ProductDetailLoader ~ product:", product)

  if (error) {
    if (error.reason === "NOT_FOUND") notFound()

    return (
      <p role="alert" className="text-sm text-destructive">
        {productsErrorMessage(error.status)}
      </p>
    )
  }

  // Bound to a local so its narrowing survives into the JSX below.
  const archivedAt = product.archivedAt
  const archived = archivedAt !== null

  console.log("🚀 ~ ProductDetailLoader ~ archivedAt:", archivedAt)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-2xl">
          {product.name}
          {archived && <Badge variant="secondary">Archived</Badge>}
        </CardTitle>
        <CardDescription>
          {archivedAt !== null
            ? `Archived ${formatDate(archivedAt)} — the product is no longer shown in the list.`
            : "Created " + formatDate(product.createdAt)}
        </CardDescription>

        {/* Hiding the buttons for a read-only user must not take the page away,
            hence performRedirect={false}. */}
        <CardAction>
          <Suspense>
            <RoleGate
              perms={[PERMISSIONS.PRODUCT_WRITE]}
              performRedirect={false}
            >
              <ProductActions
                id={product.id}
                name={product.name}
                price={Number(product.price)}
                archived={archived}
                canDelete={product.canDelete}
              />
            </RoleGate>
          </Suspense>
        </CardAction>
      </CardHeader>

      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Price</dt>
            {/* Typed `Decimal`, but it arrives over JSON as a string. */}
            <dd className="tabular-nums">
              {formatPrice(Number(product.price))}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Created</dt>
            <dd>{formatDate(product.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd>{archived ? "Archived" : "Active"}</dd>
          </div>

          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">ID</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              {product.id}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
