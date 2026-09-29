import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

/**
 * One tenant with one of everything the isolation tests read: a site, a
 * machine standing at it, a product and a completed sale.
 *
 * Names carry a random suffix and every row belongs to a fresh tenant, so test
 * files can share the one database and run in parallel without seeing each
 * other's rows through a tenant-scoped query.
 */
export async function createTenantWithData(label: string) {
  const suffix = randomUUID().slice(0, 8);

  const tenant = await prisma.tenant.create({ data: { name: `${label} ${suffix}` } });
  const site = await prisma.site.create({
    // Coordinates, or the sales map drops the site's sales before any tenant
    // filter is exercised.
    data: {
      tenantId: tenant.id,
      name: `${label} site ${suffix}`,
      city: `${label} city`,
      latitude: 56.15,
      longitude: 10.2,
    },
  });
  const machine = await prisma.machine.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      name: `${label} machine ${suffix}`,
      serialNumber: `TEST-${randomUUID()}`,
    },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: `${label} product ${suffix}`, price: 15 },
  });
  const sale = await prisma.sale.create({
    data: {
      tenantId: tenant.id,
      machineId: machine.id,
      productId: product.id,
      price: 15,
      status: "completed",
      completedAt: new Date(),
    },
  });

  return { tenant, site, machine, product, sale };
}

export type TenantData = Awaited<ReturnType<typeof createTenantWithData>>;
