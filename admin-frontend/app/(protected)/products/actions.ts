"use server"

import { PERMISSIONS } from "../../../../shared/types/permissions"
import type {
  GetProductsParams,
  GetProductsResult,
} from "@vmaas/shared/types/product"

import { getProductsPaginated } from "@/lib/data/products"
import { requirePermission } from "@/lib/dal"

import { productsErrorMessage } from "./messages"

/** Go-style result so the client component can render an error without a
 *  try/catch around every call, and without an unhandled rejection. */
export type ActionResult<T> = [error: string, data: null] | [error: null, data: T]

/**
 * Fetches one page of the active tenant's products.
 *
 * The tenant is taken from the session gate, never from the caller — a client
 * component can pick the page and sort order, but not the tenant it reads.
 */
export async function getProductsAction(
  params: GetProductsParams
): Promise<ActionResult<GetProductsResult>> {
  const { activeTenantId } = await requirePermission(PERMISSIONS.PRODUCT_READ)

  const [error, result] = await getProductsPaginated(activeTenantId, params)

  if (error) return [productsErrorMessage(error), null]

  return [null, result]
}
