import { faker } from "@faker-js/faker";
import "dotenv/config";

import { auth } from "../src/lib/auth";
import { config } from "../src/lib/config";
import { prisma } from "../src/lib/prisma";
import { DEFAULT_TENANT_ROLES, ROLE_PERMISSIONS } from "../src/lib/rbac";
import { main as seedPermissions } from "./seed";

/** Fake data for local development only. Never wired into `prisma db seed` /
 *  prisma.config.ts, so it can't run against a production database by accident.
 *  This is a second guard in case it's ever invoked directly with the wrong env. */
if (config.NODE_ENV === "production") {
  throw new Error("seed.dev.ts must not be run with NODE_ENV=production.");
}

const DEV_PASSWORD = "password123!";

async function createTenantRoles(tenantId: string) {
  const roles = new Map<string, string>();

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    if (roleName === "superadmin") continue;

    const role = await prisma.role.create({ data: { name: roleName, tenantId } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
    });
    roles.set(roleName, role.id);
  }

  return roles;
}

async function createDevUser(email: string, name: string) {
  const { user } = await auth.api.signUpEmail({ body: { email, password: DEV_PASSWORD, name } });
  return prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
}

async function seedTenant(tenantNumber: number) {
  const tenant = await prisma.tenant.create({ data: { name: `${faker.company.name()} Vending` } });
  const roles = await createTenantRoles(tenant.id);

  const owner = await createDevUser(`owner${tenantNumber}@mail.com`, `Dev Tenant Owner ${tenantNumber}`);
  const members = await Promise.all(
    Array.from({ length: 4 }, () => createDevUser(faker.internet.email().toLowerCase(), faker.person.fullName())),
  );

  await prisma.userRole.create({
    data: { userId: owner.id, roleId: roles.get(DEFAULT_TENANT_ROLES.OWNER)!, tenantId: tenant.id },
  });
  const memberRoleNames = [DEFAULT_TENANT_ROLES.ADMIN, DEFAULT_TENANT_ROLES.OPERATOR, DEFAULT_TENANT_ROLES.VIEWER];
  await Promise.all(
    members.map((member, index) =>
      prisma.userRole.create({
        data: {
          userId: member.id,
          roleId: roles.get(memberRoleNames[index % memberRoleNames.length]!)!,
          tenantId: tenant.id,
        },
      }),
    ),
  );

  const products = await Promise.all(
    Array.from({ length: 6 }, () =>
      prisma.product.create({
        data: {
          tenantId: tenant.id,
          name: faker.commerce.productName(),
          price: faker.commerce.price({ min: 5, max: 50 }),
        },
      }),
    ),
  );

  for (let siteIndex = 0; siteIndex < 2; siteIndex++) {
    const site = await prisma.site.create({
      data: {
        tenantId: tenant.id,
        name: `${faker.company.buzzNoun()} ${faker.helpers.arrayElement(["Office", "Campus", "Terminal"])}`,
        addressLine1: faker.location.streetAddress(),
        postalCode: faker.location.zipCode(),
        city: faker.location.city(),
        countryCode: "DK",
        contactName: faker.person.fullName(),
        contactPhone: faker.phone.number(),
        contactEmail: faker.internet.email().toLowerCase(),
      },
    });

    for (let machineIndex = 0; machineIndex < 2; machineIndex++) {
      const machine = await prisma.machine.create({
        data: {
          tenantId: tenant.id,
          siteId: site.id,
          name: `VM-${faker.string.alphanumeric({ length: 5, casing: "upper" })}`,
          description: faker.company.catchPhrase(),
          status: faker.helpers.arrayElement(["online", "online", "online", "offline", "error"]),
        },
      });

      const machineProducts = faker.helpers.arrayElements(products, 5);
      const slots = await Promise.all(
        machineProducts.map((product, slotNumber) => {
          const beginX = faker.number.int({ min: 0, max: 3 });
          const beginY = faker.number.int({ min: 0, max: 3 });
          return prisma.slot.create({
            data: {
              machineId: machine.id,
              productId: product.id,
              slotNumber,
              beginX,
              endX: beginX + 1,
              beginY,
              endY: beginY + 1,
              quantity: faker.number.int({ min: 0, max: 10 }),
              capacity: 10,
              price: product.price,
            },
          });
        }),
      );

      await prisma.sale.createMany({
        data: Array.from({ length: faker.number.int({ min: 5, max: 20 }) }, () => {
          const slot = faker.helpers.arrayElement(slots);
          const status = faker.helpers.arrayElement(["completed", "completed", "completed", "failed", "refunded"]);
          const createdAt = faker.date.recent({ days: 30 });
          return {
            tenantId: tenant.id,
            machineId: machine.id,
            productId: slot.productId,
            status,
            price: slot.price ?? 10,
            createdAt,
            completedAt: status === "completed" || status === "refunded" ? createdAt : null,
          };
        }),
      });

      if (machine.status !== "online") {
        await prisma.securityAlert.create({
          data: {
            machineId: machine.id,
            type: machine.status === "offline" ? "offline" : "error",
            message: faker.lorem.sentence(),
          },
        });
      }
    }
  }

  return { tenant, owner };
}

/**
 * Machines that haven't been given to a tenant yet, for the superadmin's slot layout editor.
 *
 * A site always belongs to a tenant, so these stand at one of the seeded tenant's sites.
 * Slots have no product: the tenant picks those once the machine is theirs.
 */
async function seedMachinesWithoutTenant(siteId: string) {
  // A valid layout (no overlaps, nothing floating) on a 3x3 grid; y = 0 is the bottom row:
  //   y=2  [4] [3 3]
  //   y=1  [2] [3 3]
  //   y=0  [0 0] [1]
  const layout = [
    { beginX: 0, endX: 1, beginY: 0, endY: 0 },
    { beginX: 2, endX: 2, beginY: 0, endY: 0 },
    { beginX: 0, endX: 0, beginY: 1, endY: 1 },
    { beginX: 1, endX: 2, beginY: 1, endY: 2 },
    { beginX: 0, endX: 0, beginY: 2, endY: 2 },
  ];

  const withLayout = await prisma.machine.create({
    data: { siteId, name: `VM-NEW-${faker.string.alphanumeric({ length: 4, casing: "upper" })}` },
  });
  await prisma.slot.createMany({
    data: layout.map((rect, slotNumber) => ({ machineId: withLayout.id, slotNumber, ...rect, capacity: 10 })),
  });

  // And one with no slots at all, to start a layout from scratch
  await prisma.machine.create({
    data: { siteId, name: `VM-NEW-${faker.string.alphanumeric({ length: 4, casing: "upper" })}` },
  });
}

async function main() {
  await seedPermissions();

  const superadmin = await createDevUser("admin@mail.com", "Dev Superadmin");
  await prisma.user.update({ where: { id: superadmin.id }, data: { isSuperAdmin: true } });

  const tenants = await Promise.all(Array.from({ length: 2 }, (_, index) => seedTenant(index + 1)));

  const site = await prisma.site.findFirstOrThrow({ where: { tenantId: tenants[0]!.tenant.id } });
  await seedMachinesWithoutTenant(site.id);

  console.log(`Seeded dev data: superadmin admin@mail.com (password: ${DEV_PASSWORD})`);
  console.log("  2 machines without a tenant, for the slot layout editor");
  for (const { tenant, owner } of tenants) {
    console.log(`  Tenant "${tenant.name}" — owner ${owner.email} (password: ${DEV_PASSWORD})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
