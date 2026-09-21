import type { machine_status } from "@prisma"

/**
 * How a machine's status reads in the UI.
 *
 * `machine_status` is derived from the broker's own connection lifecycle, not
 * published by the machine: EMQX's `client_connected`/`client_disconnected`
 * events reach `POST /api/internal/mqtt/connection` and `connection.service.ts`
 * moves the column. What the firmware contributes is holding the connection
 * open (`Main-Controller/src/broker_client.cpp`). Either way it is only ever
 * shown here — there is no form that sets it. Kept out of both the table and
 * the detail page so the list and the page cannot drift into wording the same
 * state differently.
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
