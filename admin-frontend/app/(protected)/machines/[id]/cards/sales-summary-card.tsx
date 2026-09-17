import { formatPrice } from "@/lib/utils"
import type { MachineKpi } from "@vmaas/shared/types/machine"

import { KpiCard, TrendBadge } from "./card-container"

/**
 * What the machine took over the KPI window.
 *
 * Completed sales only — the service filters them, so a pending or failed sale
 * never reaches this card and the revenue here is money actually taken. The
 * window comes from `kpi.days` rather than a constant, so changing the `days`
 * the page asks for relabels the card without a change here.
 */
export function SalesSummaryCard({ kpi }: { kpi: MachineKpi }) {
  const { revenue, count } = kpi.sales

  return (
    <KpiCard
      label={`Revenue · last ${kpi.days} days`}
      value={formatPrice(revenue.current)}

      headline={count.current === 1 ? "1 sale" : `${count.current} sales`}
      detail={`${formatPrice(revenue.previous)} over the ${kpi.days} days before`}
    />
  )
}
