import type { machine_status } from "@prisma"

/**
 * How a machine's status reads in the UI.
 *
 * `machine_status` is reported by the firmware, so it is only ever shown — there
 * is no form that sets it. Kept out of both the table and the detail page so the
 * list and the page cannot drift into wording the same state differently.
 */
export const STATUS_LABEL: Record<machine_status, string> = {
  online: "Online",
  offline: "Offline",
  error: "Error",
}

export const STATUS_VARIANT: Record<
  machine_status,
  "default" | "secondary" | "destructive"
> = {
  online: "default",
  offline: "secondary",
  error: "destructive",
}
