import { Suspense, type ReactNode } from "react"
import { notFound } from "next/navigation"

import { RoleGate } from "@/components/role-gate"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { requirePermission } from "@/lib/dal"
import { cn, formatDate, formatPrice } from "@/lib/utils"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { productsErrorMessage } from "../messages"
import { ProductActions } from "./product-actions"
import { fetchData } from "@/lib/data/data-fetch"
import { ProductDetail } from "@vmaas/shared/types/product"

export const NO_READ_ACCESS = "You do not have access to products."

/** One label/value pair in the detail card. Stacks on a phone, two columns
 *  from `sm` up, so the values stay on a single reading line. */
function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/** Fallback for the <Suspense> on the page. It mirrors the real layout rather
 *  than centring a spinner, so the page does not jump when the product lands. */
export function ProductDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-48" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

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
  await requirePermission(PERMISSIONS.PRODUCT_READ, NO_READ_ACCESS)

  const [error, product] = await fetchData<ProductDetail>(`/api/products/${id}`)

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

  return (
    <div className="space-y-6">
      {/* Same title row as the products list, with the edit/delete triggers
          where that page puts its "New product" dialog. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {product.name}
            </h1>
            {/* Spelled out in both states — "no badge" is not a status. */}
            <Badge
              variant={archived ? "secondary" : "outline"}
              className="gap-1.5"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  archived ? "bg-muted-foreground" : "bg-emerald-500"
                )}
              />
              {archived ? "Archived" : "Active"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {archivedAt !== null
              ? `Archived ${formatDate(archivedAt)} — no longer shown in the product list.`
              : `Created ${formatDate(product.createdAt)}`}
          </p>
        </div>
        {/* Hiding the buttons for a read-only user must not take the page away,
            hence performRedirect={false}. */}
        <Suspense>
          <RoleGate perms={[PERMISSIONS.PRODUCT_WRITE]} performRedirect={false}>
            <ProductActions
              id={product.id}
              name={product.name}
              price={Number(product.price)}
              archived={archived}
              canDelete={product.canDelete}
            />
          </RoleGate>
        </Suspense>
      </div>

      <Card>
        {/* The price carries the card: it is the one number an operator comes
            here to read, so it is the heading rather than a row in the list. */}
        <CardHeader className="border-b">
          <CardDescription>Price</CardDescription>
          {/* Typed `Decimal`, but it arrives over JSON as a string. */}
          <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatPrice(Number(product.price))}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <DetailRow label="Created">
              {formatDate(product.createdAt)}
            </DetailRow>

            {archivedAt !== null && (
              <DetailRow label="Archived">{formatDate(archivedAt)}</DetailRow>
            )}

            {/* Says why Delete is missing: a product stocked by a slot cannot
                be deleted, and the actions leave that button out entirely. */}
            <DetailRow label="Machine slots">
              {product.canDelete
                ? "Not stocked in any slot"
                : "Stocked in at least one slot — it cannot be deleted"}
            </DetailRow>

            <DetailRow label="ID">
              <span className="font-mono text-xs text-muted-foreground">
                {product.id}
              </span>
            </DetailRow>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
