import type {
  CreateProductError,
  DeleteProductError,
  GetProductError,
  GetProductsError,
  SetProductArchivedError,
  UpdateProductError,
} from "@/lib/data/products"

/**
 * The data layer reports a tagged `reason`; the wording is decided here, at the
 * only layer that knows this is an English admin UI.
 *
 * Its own module rather than actions.ts: a `"use server"` file may only export
 * async functions, so a plain helper cannot live there. It is also imported by
 * client components, which is why it stays free of server-only imports.
 *
 * The parameter is the union of every product error — wider than what any one
 * call site passes. Narrowing is the data layer's job, and a narrower union is
 * assignable to this one, so a single set of wordings serves all seven
 * functions without letting any of them report a reason its endpoint cannot
 * actually produce.
 */
// type ProductsError =
//   | GetProductsError
//   | GetProductError
//   | CreateProductError
//   | UpdateProductError
//   | DeleteProductError
//   | SetProductArchivedError

export function productsErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have access to products."
    case 404:
      return "That product no longer exists."
    case 400:
      return "That request could not be read. Reload the page and try again."
    case 409:
      return "That product is in use and cannot be changed."
    case 500:
      // The backend already logged the cause; the page only needs something to show.
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/** What the user was trying to do, used to word a failed write. */
export type ProductWriteAction = "create" | "save" | "delete" | "archive"

/**
 * Wording for a write, where the same `reason` means something else than it
 * does on a read — a 403 here is a missing write permission, not missing access
 * to the section, and CONFLICT only ever comes back from a blocked delete.
 */
export function productWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to change products."
    case 404:
      return "That product no longer exists."
    case 409:
      return "That product is stocked in one or more slots and cannot be deleted. Archive it instead."
    case 400:
      return "Check the fields and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}
