import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { RoleGate } from "@/components/role-gate"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import {
  NO_READ_ACCESS,
  ProductDetailLoader,
  ProductDetailSkeleton,
} from "./product-detail"

/**
 * A single product.
 *
 * Everything below the back link depends on the session and on the product, so
 * the static shell is the link alone — the rest streams in behind <Suspense>,
 * behind a skeleton of the same shape so nothing moves when it arrives. The
 * title row belongs to the loader for the same reason: it names the product, so
 * it cannot render before the product is read. The guard sits on the page
 * rather than on the protected layout, which reads no session on purpose.
 *
 * Narrower than the products list: four fields spread over the full container
 * width read as an empty page.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link
        href="/products"
        className="-ml-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to products
      </Link>

      <Suspense fallback={<ProductDetailSkeleton />}>
        <RoleGate perms={[PERMISSIONS.PRODUCT_READ]} reason={NO_READ_ACCESS}>
          <ProductDetailLoader params={params} />
        </RoleGate>
      </Suspense>
    </div>
  )
}
