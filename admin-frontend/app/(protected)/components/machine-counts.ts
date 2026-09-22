import type { machine_status } from "@prisma"

/**
 * The machine tallies behind the KPI row, as one pure function so the rule
 * that `never_seen` is not a service call is testable and stated once.
 *
 * `never_seen` means no broker event has ever landed for that machine (see
 * `machines/status.ts`). It is deliberately absent from `needsService`: a
 * machine that was never set up is not broken, and putting it in the same
 * figure as a machine that went dark would make that figure unactionable.
 */
export type MachineCounts = {
  online: number
  offline: number
  error: number
  neverSeen: number
  needsService: number
}

export function machineCounts(machines: readonly { status: machine_status }[] | null): MachineCounts {
  const count = (status: machine_status) => machines?.filter((m) => m.status === status).length ?? 0

  const offline = count("offline")
  const error = count("error")

  return {
    online: count("online"),
    offline,
    error,
    neverSeen: count("never_seen"),
    needsService: offline + error,
  }
}
