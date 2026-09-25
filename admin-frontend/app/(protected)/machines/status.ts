import type { machine_status } from "@prisma"

/**
 * How a machine's status reads in the UI.
 *
 * The machine never publishes `machine_status`. It comes from the broker:
 * EMQX's `client_connected`/`client_disconnected` events reach `POST
 * /api/internal/mqtt/connection`, and `connection.service.ts` moves the
 * column. The firmware only holds the connection open
 * (`Main-Controller/src/broker_client.cpp`). Nothing sets it from a form.
 *
 * Shared by the table and the detail page so the two cannot word the same
 * state differently.
 */
export const STATUS_LABEL: Record<machine_status, string> = {
  never_seen: "Never seen",
  online: "Online",
  offline: "Offline",
  error: "Error",
}

export const STATUS_VARIANT: Record<
  machine_status,
  "default" | "secondary" | "destructive" | "outline"
> = {
  never_seen: "outline",
  online: "default",
  offline: "secondary",
  error: "destructive",
}
