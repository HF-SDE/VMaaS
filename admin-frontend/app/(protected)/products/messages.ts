import type { ProductsError } from "@/lib/data/products"

/**
 * The data layer reports a `reason`; the wording for the user is decided here,
 * at the only layer that knows this is a Danish admin UI.
 *
 * Its own module rather than actions.ts: a `"use server"` file may only export
 * async functions, so a plain helper cannot live there.
 */
export function productsErrorMessage(error: ProductsError): string {
  switch (error.reason) {
    case "unauthorized":
      return "Din session er udløbet. Log ind igen."
    case "forbidden":
      return "Du har ikke adgang til produkter."
    default:
      // The backend already logged the cause; the page only needs something to show.
      return "Kunne ikke hente produkter"
  }
}
