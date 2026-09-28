import type { ReactNode } from "react"
import Link from "next/link"
import { cn } from "cn"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import { DEFAULT_SALES_SUMMARY_DAYS } from "@vmaas/shared/types/sale"

import { getAlertsSummary } from "@/lib/data/alerts"
import { getMachines } from "@/lib/data/machines"
import { getSalesSummary } from "@/lib/data/sales"
import { getLowStockSlots } from "@/lib/data/slots"
import { requireAccess } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { machineCounts } from "./machine-counts"
import { RevenueSparkline } from "./revenue-chart"

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "DKK",
  maximumFractionDigits: 0,
})

/** Shown in place of a figure whose read failed. A dash in one card costs less
 *  than a SectionError that takes the whole row away. */
const NO_VALUE = "—"

function Kpi({
  label,
  value,
  hint,
  href,
  className,
  children,
}: {
  label: string
  value: string | number
  hint?: string
  href: string
  /** Grid spans only — the two cards carrying a chart take two columns. */
  className?: string
  children?: ReactNode
}) {
  return (
    <Link href={href} className={cn("block h-full", className)}>
      <Card size="sm" className="h-full transition-colors hover:bg-accent/40">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
        </CardHeader>
        {(hint || children) && (
          <CardContent>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            {children}
          </CardContent>
        )}
      </Card>
    </Link>
  )
}

/**
 * The numbers the rest of the dashboard used to bury inside its sections, lifted
 * into one row at the top: how bad it is, what the fleet is doing, and what it
 * earned.
 *
 * hasPermission rather than requirePermission, like the sections below — a user
 * missing one of the three reads loses those cards, not the page, and the grid
 * reflows around whatever is left.
 */
export async function KpiCards() {
  const session = await requireAccess()
  const canReadAlerts = hasPermission(session, PERMISSIONS.ALERT_READ)
  const canReadMachines = hasPermission(session, PERMISSIONS.MACHINE_READ)
  const canReadSales = hasPermission(session, PERMISSIONS.SALE_READ)

  // One round trip for the row rather than four in series. getMachines throws
  // where the others return a Result, so it is caught into the same null.
  const [alertsResult, machines, lowStockResult, salesResult] =
    await Promise.all([
      canReadAlerts ? getAlertsSummary() : null,
      canReadMachines ? getMachines().catch(() => null) : null,
      canReadMachines ? getLowStockSlots() : null,
      canReadSales ? getSalesSummary() : null,
    ])

  const alerts = alertsResult?.[1] ?? null
  const lowStock = lowStockResult?.[1] ?? null
  const sales = salesResult?.[1] ?? null

  const {
    online,
    offline,
    error: errored,
    neverSeen,
    needsService,
  } = machineCounts(machines)
  const empty = lowStock?.filter((s) => s.quantity === 0).length ?? 0

  return (
    // Two columns on a phone, so the four plain figures sit half-width; the two
    // cards carrying a chart span both. Four across from md, all eight columns
    // in one row from xl.
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
      {canReadAlerts && (
        <Kpi
          label="Open alerts"
          value={alerts?.openTotal ?? NO_VALUE}
          hint={
            alerts
              ? `${alerts.openByType.tamper} tamper · ${alerts.openByType.offline} offline · ${alerts.openByType.error} error`
              : "Couldn't load alerts."
          }
          href="/machines/alerts"
        />
      )}

      {canReadMachines && (
        <>
          <Kpi
            label="Machines online"
            value={machines ? online : NO_VALUE}
            hint={
              machines
                ? `of ${machines.length} ${machines.length === 1 ? "machine" : "machines"}${neverSeen > 0 ? ` · ${neverSeen} never seen` : ""}`
                : "Couldn't load machines."
            }
            href="/machines"
          />
          <Kpi
            label="Needs service"
            value={machines ? needsService : NO_VALUE}
            hint={
              machines
                ? `${offline} offline · ${errored} error`
                : "Couldn't load machines."
            }
            href="/machines"
          />
          <Kpi
            label="Slots to restock"
            value={lowStock?.length ?? NO_VALUE}
            hint={lowStock ? `${empty} empty` : "Couldn't load stock levels."}
            href="/machines"
          />
        </>
      )}

      {canReadSales && (
        <>
          <Kpi
            label="Revenue today"
            value={sales ? money.format(sales.today.revenue) : NO_VALUE}
            hint={
              sales
                ? `${sales.today.count} ${sales.today.count === 1 ? "sale" : "sales"} · 7-day trend`
                : "Couldn't load sales."
            }
            href="/sales"
            className="col-span-2"
          >
            {/* The week behind today rather than today itself: a single day has
                no shape, and the figure above is already the day. */}
            {sales && <RevenueSparkline daily={sales.daily.slice(-7)} />}
          </Kpi>
          <Kpi
            label={`Revenue · ${DEFAULT_SALES_SUMMARY_DAYS} days`}
            value={sales ? money.format(sales.last30Days.revenue) : NO_VALUE}
            hint={
              sales
                ? `${sales.last30Days.count} ${sales.last30Days.count === 1 ? "sale" : "sales"}`
                : "Couldn't load sales."
            }
            href="/sales"
            className="col-span-2"
          >
            {sales && <RevenueSparkline daily={sales.daily} />}
          </Kpi>
        </>
      )}
    </div>
  )
}
