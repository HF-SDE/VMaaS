"use server"
import type { GetProductsParams } from "@vmaas/shared/types/product"

import { revalidatePath } from "next/cache"
import { err, ok } from "@vmaas/shared/lib/error-handling"

/** A write to one product invalidates both the list and that product's page. */
function revalidateMachine(id: string) {
  revalidatePath("/machines")
  revalidatePath("/machines/" + id)
}

/**
 * Fetches one page of the active tenant's products.
 *
 * The tenant is taken from the session gate, never from the caller — a client
 * component can pick the page and sort order, but not the tenant it reads.
 */
export async function getMachinesAction(params: GetProductsParams) {
  const [error, result] = await getMachinesPaginated(params)

  if (error) return err(error)

  return ok(result)
}

export async function createMachineAction(input: {
  name: string
  price: number
}) {
  const [error, product] = await createMachine(input.name, input.price)

  if (error) return err(error)

  revalidateMachine(product.id)
  return ok(product)
}

export async function updateMachineAction(
  id: string,
  input: { name?: string; price?: number }
) {
  const [error, product] = await updateMachine(id, input)

  if (error) return err(error)

  revalidateMachine(id)
  return ok(product)
}

export async function setMachineArchivedAction(id: string, archived: boolean) {
  const [error, product] = await setMachineArchived(id, archived)

  if (error) return err(error)

  revalidateMachine(id)
  return ok(product)
}

/**
 * Deletes and reports the outcome; the caller navigates. Redirecting here would
 * throw through the client component's `await`, so the dialog could not close
 * itself or show a failure.
 */
export async function deleteMachineAction(id: string) {
  const [error] = await deleteMachine(id)

  if (error) return err(error)

  revalidateMachine(id)
  return ok(null)
}
