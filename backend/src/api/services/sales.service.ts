import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import {
  DEFAULT_SALES_MAP_DAYS,
  DEFAULT_SALES_SUMMARY_DAYS,
  type GetSalesMapParams,
  type GetSalesSummaryParams,
  MAX_SALES_MAP_DAYS,
  MAX_SALES_SUMMARY_DAYS,
  type SaleMapPoint,
  type SalesDayPoint,
  type SalesSummary,
  type SalesTotals,
  type TopProduct,
} from "@vmaas/shared/types/sale";

export type UnknownSalesError = { reason: "UNKNOWN_ERROR"; message: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function getSalesService(tenantId: string) {
  const sales = await prisma.sale.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      machine: { include: { site: { select: { id: true, name: true } } } },
      product: true,
    },
  });

  // A sale is rung up by a machine that is in service, which by the
  // tenant/site invariant (see machines.service.ts) always has a site by the
  // time it can sell anything. A `null` site here means that invariant broke
  // somewhere else, not that this sale did anything wrong — dropped rather
  // than asserted away with a cast or left to crash the sales table.
  return sales.flatMap((sale) => {
    if (!sale.machine.site) {
      console.error(`[sales.service] invariant violated: sale ${sale.id}'s machine ${sale.machineId} has no site`);
      return [];
    }
    return [{ ...sale, machine: { ...sale.machine, site: sale.machine.site } }];
  });
}

export async function getSalesMapService(
  tenantId: string,
  params: GetSalesMapParams = {},
): Promise<Result<UnknownSalesError, SaleMapPoint[]>> {
  const days = Math.min(MAX_SALES_MAP_DAYS, Math.max(1, Math.trunc(params.days ?? DEFAULT_SALES_MAP_DAYS)));
  const since = new Date(Date.now() - days * MS_PER_DAY);

  try {
    const sales = await prisma.sale.findMany({
      where: { tenantId, status: "completed", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        price: true,
        createdAt: true,
        product: { select: { name: true } },
        machine: {
          select: {
            id: true,
            name: true,
            site: { select: { id: true, name: true, latitude: true, longitude: true } },
          },
        },
      },
    });

    return ok(
      sales.flatMap((sale) => {
        const { site } = sale.machine;
        if (!site || site.latitude === null || site.longitude === null) return [];

        return [
          {
            id: sale.id,
            price: Number(sale.price),
            createdAt: sale.createdAt.toISOString(),
            productName: sale.product?.name ?? null,
            machineId: sale.machine.id,
            machineName: sale.machine.name,
            siteId: site.id,
            siteName: site.name,
            latitude: Number(site.latitude),
            longitude: Number(site.longitude),
          },
        ];
      }),
    );
  } catch (error) {
    // TODO: capture sentry error
    console.error("[sales.service] building the sales map failed", error);

    return err({
      reason: "UNKNOWN_ERROR",
      message: "An unknown error occurred while loading the sales map.",
    });
  }
}

const TOP_PRODUCTS_LIMIT = 5;

/** The columns the summary needs. `price` is a Decimal on the row and a number
 *  by the time it reaches `summariseSales`, which is where the conversion at the
 *  service boundary lands. */
export interface SummarySaleRow {
  price: number;
  createdAt: Date;
  productId: string | null;
  product: { name: string } | null;
}

/** `YYYY-MM-DD` in UTC. The whole summary buckets in UTC, consistent with how
 *  `buildAlertWhere` reads its date filter — a `<input type="date">` has no zone
 *  to offer, so picking one here would only be a guess applied inconsistently. */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addTo(totals: SalesTotals, price: number): void {
  totals.revenue += price;
  totals.count += 1;
}

/**
 * The half of the sales summary with no database in it.
 *
 * `now` is a parameter rather than `new Date()` so the day boundaries are
 * assertable — a summary that reads the clock cannot be tested for what it does
 * at one minute to midnight. Exported for its own test.
 */
export function summariseSales(sales: SummarySaleRow[], days: number, now: Date): SalesSummary {
  const today: SalesTotals = { revenue: 0, count: 0 };
  const last7Days: SalesTotals = { revenue: 0, count: 0 };
  const last30Days: SalesTotals = { revenue: 0, count: 0 };

  // Seeded with every day in the window before a single sale is read: a day
  // with nothing sold has to survive to the chart as a zero.
  const daily = new Map<string, SalesDayPoint>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = utcDay(new Date(now.getTime() - offset * MS_PER_DAY));
    daily.set(date, { date, revenue: 0, count: 0 });
  }

  const todayKey = utcDay(now);
  const since7 = now.getTime() - 7 * MS_PER_DAY;
  const since30 = now.getTime() - 30 * MS_PER_DAY;
  const byProduct = new Map<string, TopProduct>();

  for (const sale of sales) {
    const at = sale.createdAt.getTime();
    const key = utcDay(sale.createdAt);

    const day = daily.get(key);
    if (day) {
      day.revenue += sale.price;
      day.count += 1;
    }

    if (key === todayKey) addTo(today, sale.price);
    if (at >= since7) addTo(last7Days, sale.price);
    if (at >= since30) addTo(last30Days, sale.price);

    // A sale outlives the product it sold — `Sale.productId` is nullable — so it
    // counts toward revenue but has no name to rank.
    if (sale.productId && sale.product) {
      const existing = byProduct.get(sale.productId) ?? {
        productId: sale.productId,
        name: sale.product.name,
        count: 0,
        revenue: 0,
      };
      existing.count += 1;
      existing.revenue += sale.price;
      byProduct.set(sale.productId, existing);
    }
  }

  return {
    today,
    last7Days,
    last30Days,
    daily: [...daily.values()],
    topProducts: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, TOP_PRODUCTS_LIMIT),
  };
}

/**
 * The tiles, the daily chart and the top products, for the dashboard's sales
 * card. Completed sales only — see `SalesSummary`.
 */
export async function getSalesSummaryService(
  tenantId: string,
  params: GetSalesSummaryParams = {},
): Promise<Result<UnknownSalesError, SalesSummary>> {
  const days = Math.min(MAX_SALES_SUMMARY_DAYS, Math.max(1, Math.trunc(params.days ?? DEFAULT_SALES_SUMMARY_DAYS)));
  const now = new Date();
  // From the start of the window's first UTC day, not from this time of day
  // `days` ago, or the oldest bucket would be a partial day rendered beside
  // whole ones and read as a slump.
  const since = new Date(
    `${new Date(now.getTime() - (days - 1) * MS_PER_DAY).toISOString().slice(0, 10)}T00:00:00.000Z`,
  );

  try {
    const sales = await prisma.sale.findMany({
      where: { tenantId, status: "completed", createdAt: { gte: since } },
      select: { price: true, createdAt: true, productId: true, product: { select: { name: true } } },
    });

    return ok(
      summariseSales(
        sales.map((sale) => ({ ...sale, price: Number(sale.price) })),
        days,
        now,
      ),
    );
  } catch (error) {
    // TODO: capture sentry error
    console.error("[sales.service] summarising failed", error);

    return err({
      reason: "UNKNOWN_ERROR",
      message: "An unknown error occurred while summarising the sales.",
    });
  }
}
