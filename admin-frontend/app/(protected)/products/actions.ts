"use server"
import type { GetProductsParams } from "@vmaas/shared/types/product"
import {
  createProduct,
  deleteProduct,
  getProductsPaginated,
  setProductArchived,
  updateProduct,
} from "@/lib/data/products"
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
  const [error, result] = await getProductsPaginated(params)

  if (error) return err(error)

  return ok(result)
}

export async function createProductAction(input: {
  name: string
  price: number
}) {
  const [error, product] = await createProduct(input.name, input.price)

  if (error) return err(error)

  revalidateProduct(product.id)
  return ok(product)
}

export async function updateProductAction(
  id: string,
  input: { name?: string; price?: number }
) {
  const [error, product] = await updateProduct(id, input)

  if (error) return err(error)

  revalidateProduct(id)
  return ok(product)
}

export async function setProductArchivedAction(id: string, archived: boolean) {
  const [error, product] = await setProductArchived(id, archived)

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
  const [error] = await deleteProduct(id)

  if (error) return err(error)

  revalidateProduct(id)
  return ok(null)
}
