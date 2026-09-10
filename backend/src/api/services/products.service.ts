import { prisma } from "@/lib/prisma";

export async function getProductsService(tenantId: string) {
  const machines = await prisma.product.findMany({ where: { tenantId } });

  return machines;
}

export async function createProductService(tenantId: string, name: string, price: number) {
  const machine = await prisma.product.create({ data: { name, tenantId, price } });

  return machine;
}
