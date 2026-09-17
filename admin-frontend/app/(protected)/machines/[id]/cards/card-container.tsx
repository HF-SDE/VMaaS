import type { ReactNode } from "react"
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { MachineKpiTrend } from "@vmaas/shared/types/machine"

import type { MachineDetail } from "../../form"
import { AlertsSummaryCard } from "./alerts-summary-card"
import { CurrentStatusCard } from "./current-status-card"
import { SalesSummaryCard } from "./sales-summary-card"
import { StockLevelsCard } from "./stock-levels-card"
import { cn } from "@/lib/utils"

/**
 * The four KPI cards at the top of a machine's overview.
 *
 * Four across on a wide screen, two rows of two below that. Two columns rather
 * than one on a phone: these are short figures, and a single column would push
 * the rest of the overview a full screen down.
 *
 * Every card reads from the machine the page already loaded — `machine.kpi`
 * arrives with it, so none of them fetches anything of its own and none of them
 * can render a window the others are not showing.
 */
export function MachineCards({ machine }: { machine: MachineDetail }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <CurrentStatusCard machine={machine} />
      <SalesSummaryCard kpi={machine.kpi} />
      <StockLevelsCard kpi={machine.kpi} />
      <AlertsSummaryCard kpi={machine.kpi} />
    </div>
  )
}

type KpiCardProps = {
  /** What the figure is, above it and in small type. */
  label: string
  /** The figure itself — a node, not a string, so a card can colour it. */
  value: ReactNode
  /** Top-right slot, a <TrendBadge> on the cards that have a window. */
  action?: ReactNode
  /** The one line that says what the figure means. */
  headline: ReactNode
  /** The supporting line under it, in muted type. */
  detail: ReactNode
  /** Whether the card should render in a compact style. */
  compact?: boolean
  /** The large text displayed prominently in the card. */
  megaText?: ReactNode
}

/**
 * The shell all four cards share, so they cannot drift apart in type size or
 * spacing. It holds no data and makes no decisions: each card works out its own
 * figures and hands them over already formatted.
 */
export function KpiCard({
  label,
  value,
  action,
  headline,
  detail,
  megaText,
}: KpiCardProps) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            megaText ? "text-3xl" : "text-2xl",
            "font-semibold tabular-nums @[250px]/card:text-3xl"
          )}
        >
          {value}
        </CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardFooter className="mt-auto flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 font-medium">{headline}</div>
        <div className="text-muted-foreground">{detail}</div>
      </CardFooter>
    </Card>
  )
}

/**
 * How this window compares with the one before it.
 *
 * Renders nothing when the previous window is zero: a percentage against no
 * baseline is either infinite or meaningless, and "+100%" off a single sale
 * reads as a result when it is noise. The card's own copy carries whether up is
 * good, so the badge stays neutral — more alerts and more revenue both point
 * the arrow the same way.
 */
export function TrendBadge({ trend }: { trend: MachineKpiTrend }) {
  if (trend.previous === 0) return null

  const change = ((trend.current - trend.previous) / trend.previous) * 100
  const Icon = change < 0 ? TrendingDownIcon : TrendingUpIcon

  return (
    <Badge variant="outline">
      <Icon />
      {change > 0 && "+"}
      {change.toFixed(1)}%
    </Badge>
  )
}
