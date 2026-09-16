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

  return sales;
}
