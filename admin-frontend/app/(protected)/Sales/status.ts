import type { sale_status } from "@prisma"

/** How a sale's status reads in the UI — shared by the table and its filter. */
export const SALE_STATUS_LABEL: Record<sale_status, string> = {
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
  refunded: "Refunded",
}

export const SALE_STATUS_VARIANT: Record<
  sale_status,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  completed: "default",
  failed: "destructive",
  refunded: "outline",
}
