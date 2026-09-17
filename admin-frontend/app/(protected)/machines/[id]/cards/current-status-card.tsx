import type { machine_status } from "@prisma"

import { formatDateTime } from "@/lib/utils"

import type { MachineDetail } from "../../form"
import { STATUS_LABEL } from "../../status"
import { KpiCard } from "./card-container"

/**
 * How the status reads as a figure rather than as a badge.
 *
 * The badge beside the page title already carries the same state in
 * `STATUS_VARIANT`; repeating it here would be two of the same control, so the
 * card colours the word itself instead. Muted for offline on purpose — a
 * machine that is off is not a fault, only a fact.
 */
const STATUS_TONE: Record<machine_status, string> = {
  online: "text-emerald-600 dark:text-emerald-400",
  offline: "text-red-600 dark:text-red-400",
  error: "text-destructive",
}

/**
 * Where the machine stands and whether it is answering.
 *
 * The only card of the four with no window: status is what the firmware last
 * reported, so there is nothing to compare it against. The last sale stands in
 * for a heartbeat — a machine reporting "online" that has sold nothing in weeks
 * is worth a second look, and that is a judgement the reader makes.
 */
export function CurrentStatusCard({ machine }: { machine: MachineDetail }) {
  const { lastSaleAt } = machine.kpi

  return (
    <KpiCard
      label="Current status"
      value={
        <span className={STATUS_TONE[machine.status]}>
          {STATUS_LABEL[machine.status]}
        </span>
      }
      headline={machine.site.name}
      detail={
        lastSaleAt
          ? `Last sale ${formatDateTime(lastSaleAt)}`
          : "No sales recorded yet"
      }
    />
  )
}
