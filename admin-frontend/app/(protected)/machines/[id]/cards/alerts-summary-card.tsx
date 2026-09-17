import type { MachineKpi } from "@vmaas/shared/types/machine"

import { KpiCard, TrendBadge } from "./card-container"

/**
 * What the machine has been reporting, and what is still outstanding.
 *
 * The figure is the count still unresolved rather than the count over the
 * window: that is the number someone has to act on, and it does not fall off
 * the end of a window just because the alert is old. The trend below it is
 * about how many came in, which is the part a window can speak to.
 */
export function AlertsSummaryCard({ kpi }: { kpi: MachineKpi }) {
  const { open, logged } = kpi.alerts

  return (
    <KpiCard
      megaText={true}
      label="Open alerts"
      value={open}
      action={<TrendBadge trend={logged} />}
      headline={
        logged.current === 1
          ? `1 raised in the last ${kpi.days} days`
          : `${logged.current} raised in the last ${kpi.days} days`
      }
      detail={`${logged.previous} over the ${kpi.days} days before`}
    />
  )
}
