import { prisma } from "@/lib/prisma";

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
