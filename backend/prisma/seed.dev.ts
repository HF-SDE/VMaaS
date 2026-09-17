import { faker } from "@faker-js/faker";
import "dotenv/config";
import { randomUUID } from "node:crypto";

import type { Prisma, Slot } from "../src/generated/prisma/client";
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

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type SlotHistory = {
  sales: Prisma.SaleCreateManyInput[];
  movements: Prisma.InventoryMovementCreateManyInput[];
  /** Balance the movements add up to — what the slot's `quantity` must be. */
  quantity: number;
};

/** Walks a slot's sales in chronological order and writes the inventory movement
 *  that explains each one, so `sum(movements.quantity) === slot.quantity` holds.
 *  The slot is restocked whenever it would otherwise sell below zero. */
function planSlotHistory(slot: Slot, tenantId: string, machineId: string, staffIds: string[]): SlotHistory {
  const sales: Prisma.SaleCreateManyInput[] = [];
  const movements: Prisma.InventoryMovementCreateManyInput[] = [];
  const restocker = () => faker.helpers.arrayElement(staffIds);

  const openedAt = new Date(Date.now() - 31 * DAY_MS);
  movements.push({
    tenantId,
    slotId: slot.id,
    type: "restock",
    quantity: slot.capacity,
    userId: restocker(),
    occurredAt: openedAt,
    note: "Initial stocking",
  });
  let quantity = slot.capacity;

  const saleDates = Array.from({ length: faker.number.int({ min: 3, max: 8 }) }, () =>
    faker.date.recent({ days: 30 }),
  ).sort((a, b) => a.getTime() - b.getTime());

  for (const createdAt of saleDates) {
    const status = faker.helpers.arrayElement(["completed", "completed", "completed", "failed", "refunded"] as const);
    const saleId = randomUUID();
    sales.push({
      id: saleId,
      tenantId,
      machineId,
      productId: slot.productId,
      status,
      price: slot.price ?? 10,
      createdAt,
      completedAt: status === "completed" || status === "refunded" ? createdAt : null,
    });

    // The motor ran but nothing dropped, so the product is still in the slot:
    // the movement records the attempt without moving stock.
    if (status === "failed") {
      movements.push({
        tenantId,
        slotId: slot.id,
        saleId,
        type: "dispense_failure",
        quantity: 0,
        occurredAt: createdAt,
        note: "Motor ran, nothing dropped",
      });
      continue;
    }

    if (quantity === 0) {
      const refill = slot.capacity;
      movements.push({
        tenantId,
        slotId: slot.id,
        type: "restock",
        quantity: refill,
        userId: restocker(),
        occurredAt: new Date(createdAt.getTime() - 30 * MINUTE_MS),
        note: "Route refill",
      });
      quantity += refill;
    }

    // A refunded sale still left the machine — the money came back, the product didn't.
    movements.push({ tenantId, slotId: slot.id, saleId, type: "sale", quantity: -1, occurredAt: createdAt });
    quantity -= 1;
  }

  // Shrinkage is only ever observed as a recount that disagrees with the ledger.
  if (quantity > 0 && faker.datatype.boolean({ probability: 0.2 })) {
    movements.push({
      tenantId,
      slotId: slot.id,
      type: "correction",
      quantity: -1,
      userId: restocker(),
      occurredAt: new Date(Date.now() - faker.number.int({ min: 1, max: 48 }) * 60 * MINUTE_MS),
      note: "Physical recount was one short",
    });
    quantity -= 1;
  }

  return { sales, movements, quantity };
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

  const staffIds = [owner.id, ...members.map((member) => member.id)];

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
          const beginX = (slotNumber % 3) * 100;
          const beginY = Math.floor(slotNumber / 3) * 100;
          return prisma.slot.create({
            data: {
              machineId: machine.id,
              productId: product.id,
              slotNumber,
              beginX,
              endX: beginX + 90,
              beginY,
              endY: beginY + 90,
              quantity: 0,
              capacity: 10,
              price: product.price,
            },
          });
        }),
      );

      // Sales and movements are written from one plan per slot, so the ledger and
      // the slot's quantity can't drift apart.
      const histories = slots.map((slot) => planSlotHistory(slot, tenant.id, machine.id, staffIds));

      await prisma.sale.createMany({ data: histories.flatMap((history) => history.sales) });
      await prisma.inventoryMovement.createMany({ data: histories.flatMap((history) => history.movements) });
      await Promise.all(
        slots.map((slot, index) =>
          prisma.slot.update({ where: { id: slot.id }, data: { quantity: histories[index]!.quantity } }),
        ),
      );

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

async function main() {
  await seedPermissions();

  const superadmin = await createDevUser("admin@mail.com", "Dev Superadmin");
  await prisma.user.update({ where: { id: superadmin.id }, data: { isSuperAdmin: true } });

  const tenants = await Promise.all(Array.from({ length: 2 }, (_, index) => seedTenant(index + 1)));

  console.log(`Seeded dev data: superadmin admin@mail.com (password: ${DEV_PASSWORD})`);
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
