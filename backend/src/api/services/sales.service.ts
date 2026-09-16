import { prisma } from "@/lib/prisma";

export async function getSalesService(tenantId: string) {
  const sales = await prisma.sale.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      machine: true,
      product: true,
    },
  });

  return sales;
}
