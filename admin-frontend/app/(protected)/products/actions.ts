"use server"

import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import type { GetProductsParams } from "@vmaas/shared/types/product"

import {
  createProduct,
  deleteProduct,
  getProductsPaginated,
  setProductArchived,
  updateProduct,
} from "@/lib/data/products"
import { requirePermission } from "@/lib/dal"

import { revalidatePath } from "next/cache"
import { err, ok } from "@vmaas/shared/lib/error-handling"

/** A write to one product invalidates both the list and that product's page. */
function revalidateProduct(id: string) {
  revalidatePath("/products")
  revalidatePath("/products/" + id)
}

/**
 * Fetches one page of the active tenant's products.
 *
 * The tenant is taken from the session gate, never from the caller — a client
 * component can pick the page and sort order, but not the tenant it reads.
 */
export async function getProductsAction(params: GetProductsParams) {
  const { activeTenantId } = await requirePermission(PERMISSIONS.PRODUCT_READ)

  const [error, result] = await getProductsPaginated(activeTenantId, params)

  if (error) return err(error)

  return ok(result)
}

export async function createProductAction(input: {
  name: string
  price: number
}) {
  const { activeTenantId } = await requirePermission(PERMISSIONS.PRODUCT_WRITE)

  const [error, product] = await createProduct(
    activeTenantId,
    input.name,
    input.price
  )

  if (error) return err(error)

  revalidateProduct(product.id)
  return ok(product)
}

export async function updateProductAction(
  id: string,
  input: { name?: string; price?: number }
) {
  const { activeTenantId } = await requirePermission(PERMISSIONS.PRODUCT_WRITE)

  const [error, product] = await updateProduct(activeTenantId, id, input)

  if (error) return err(error)

  revalidateProduct(id)
  return ok(product)
}

export async function setProductArchivedAction(id: string, archived: boolean) {
  const { activeTenantId } = await requirePermission(PERMISSIONS.PRODUCT_WRITE)

  const [error, product] = await setProductArchived(
    activeTenantId,
    id,
    archived
  )

  if (error) return err(error)

  revalidateProduct(id)
  return ok(product)
}

/**
 * Deletes and reports the outcome; the caller navigates. Redirecting here would
 * throw through the client component's `await`, so the dialog could not close
 * itself or show a failure.
 */
export async function deleteProductAction(id: string) {
  const { activeTenantId } = await requirePermission(PERMISSIONS.PRODUCT_WRITE)

  const [error] = await deleteProduct(activeTenantId, id)

  if (error) return err(error)

  revalidateProduct(id)
  return ok(null)
}
