export { cn } from "cn"

export function formatDate(dateString: string | Date): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium" }).format(date)
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
