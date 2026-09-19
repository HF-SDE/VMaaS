import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import { DEFAULT_SALES_SUMMARY_DAYS } from "@vmaas/shared/types/sale"
import type { SalesTotals } from "@vmaas/shared/types/sale"

import { getSalesSummary } from "@/lib/data/sales"
import { requireTenant } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import { RevenueChart } from "./revenue-chart"
import { SectionError } from "./section-error"

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "DKK",
  maximumFractionDigits: 0,
})

function Tile({ label, totals }: { label: string; totals: SalesTotals }) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{money.format(totals.revenue)}</p>
      <p className="text-sm text-muted-foreground">
        {totals.count} {totals.count === 1 ? "sale" : "sales"}
      </p>
    </div>
  )
}

export async function SalesSummarySection() {
  const session = await requireTenant()
  if (!hasPermission(session, PERMISSIONS.SALE_READ)) return null

  const [error, summary] = await getSalesSummary()

  if (error) {
    return (
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Sales</h2>
        <SectionError message="Couldn't load sales." />
      </section>
    )
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Sales</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Completed sales only — pending, failed and refunded sales are left out.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Today" totals={summary.today} />
        <Tile label="Last 7 days" totals={summary.last7Days} />
        <Tile label="Last 30 days" totals={summary.last30Days} />
      </div>

      <h3 className="mt-6 text-sm font-semibold">
        Revenue · last {DEFAULT_SALES_SUMMARY_DAYS} days
      </h3>
      <div className="mt-2">
        <RevenueChart daily={summary.daily} />
      </div>

      <h3 className="mt-6 text-sm font-semibold">Top products</h3>
      {summary.topProducts.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No completed sales in this window.
        </p>
      ) : (
        <ul className="mt-2 divide-y rounded-md border">
          {summary.topProducts.map((product) => (
            <li
              key={product.productId}
              className="flex justify-between p-3 text-sm"
            >
              <span>{product.name}</span>
              <span className="text-muted-foreground">
                {product.count} · {money.format(product.revenue)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
