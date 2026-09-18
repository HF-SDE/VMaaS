import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import {
  DEFAULT_SALES_MAP_DAYS,
  type GetSalesMapParams,
  MAX_SALES_MAP_DAYS,
  type SaleMapPoint,
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
