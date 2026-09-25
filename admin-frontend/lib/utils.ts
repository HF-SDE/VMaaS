export { cn } from "cn"

export function formatDate(dateString: string | Date): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium" }).format(date)
}

/** Date down to the minute, for logs — `formatDate` alone cannot separate two
 *  events on the same day. Same `da-DK` locale as the rest of the app: that is
 *  the reader's date format, not the interface language. */
export function formatDateTime(dateString: string | Date): string {
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(dateString))
}

/** Prisma serialises `Decimal` as a string, so prices arrive as e.g. "12.5". */
export function formatPrice(price: string | number): string {
  const amount = typeof price === "number" ? price : Number(price)

  if (!Number.isFinite(amount)) return "—"

  return new Intl.NumberFormat("da-DK", {
    style: "currency",
    currency: "DKK",
  }).format(amount)
}
