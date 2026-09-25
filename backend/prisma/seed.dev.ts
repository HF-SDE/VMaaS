import { faker } from "@faker-js/faker";
import "dotenv/config";
import { randomUUID } from "node:crypto";

import { contains } from "@vmaas/shared/lib/cords-grid";
import type { StockRow } from "@vmaas/shared/types/stock-row";

import type { Prisma, Slot } from "../src/generated/prisma/client";
import { generateSerialNumber } from "../src/api/services/machines.service";
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
const SUPERADMIN_EMAIL = "admin@mail.com";

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

/** Every seeded site stands on Funen, so the map view has something to show. */
const FYN_BOUNDS = { minLat: 55.02, maxLat: 55.63, minLng: 9.68, maxLng: 10.86 };

/** How big a machine's front can be built, in grid cells. */
const MACHINE_GRID = { minWidth: 4, maxWidth: 10, minHeight: 5, maxHeight: 12 };

/** The shelf sizes a machine can be fitted with, as [width, height]. */
const SLOT_SIZES = [
  [1, 1],
  [1, 2],
  [2, 1],
  [2, 2],
] as const;

/** Tiles a whole machine front with slots, scanning bottom-left to top-right and
 *  placing a random size that still fits the free space at each uncovered cell.
 *  A 1x1 always fits, so every cell ends up covered — which is what makes the
 *  layout gapless, overlap-free and, since nothing is ever left hollow, unfloatable. */
function generateSlotLayout(): StockRow[] {
  const width = faker.number.int({ min: MACHINE_GRID.minWidth, max: MACHINE_GRID.maxWidth });
  const height = faker.number.int({ min: MACHINE_GRID.minHeight, max: MACHINE_GRID.maxHeight });

  const rows: StockRow[] = [];
  const isFree = (x: number, y: number) => !rows.some((row) => contains(row, x, y));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isFree(x, y)) continue;

      const candidates = SLOT_SIZES.filter(([slotWidth, slotHeight]) => {
        if (x + slotWidth > width || y + slotHeight > height) return false;

        // Every cell the slot would cover has to still be empty
        return Array.from({ length: slotWidth }).every((_, dx) =>
          Array.from({ length: slotHeight }).every((_, dy) => isFree(x + dx, y + dy)),
        );
      });

      const [slotWidth, slotHeight] = faker.helpers.arrayElement(candidates);
      rows.push({ x_start: x, x_end: x + slotWidth - 1, y_start: y, y_end: y + slotHeight - 1 });
    }
  }

  return rows;
}

function toSlotRect(row: StockRow) {
  return { beginX: row.x_start, endX: row.x_end, beginY: row.y_start, endY: row.y_end };
}

/** A taller/wider shelf simply holds more of the product. */
function slotCapacity(row: StockRow) {
  return 5 * (row.x_end - row.x_start + 1) * (row.y_end - row.y_start + 1);
}

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

  const siteCount = faker.number.int({ min: 10, max: 40 });

  for (let siteIndex = 0; siteIndex < siteCount; siteIndex++) {
    const site = await prisma.site.create({
      data: {
        tenantId: tenant.id,
        name: `${faker.company.buzzNoun()} ${faker.helpers.arrayElement(["Office", "Campus", "Terminal"])}`,
        addressLine1: faker.location.streetAddress(),
        postalCode: faker.location.zipCode(),
        city: faker.location.city(),
        countryCode: "DK",
        latitude: faker.location.latitude({ min: FYN_BOUNDS.minLat, max: FYN_BOUNDS.maxLat }),
        longitude: faker.location.longitude({ min: FYN_BOUNDS.minLng, max: FYN_BOUNDS.maxLng }),
        contactName: faker.person.fullName(),
        contactPhone: faker.phone.number(),
        contactEmail: faker.internet.email().toLowerCase(),
      },
    });

    for (let machineIndex = 0; machineIndex < 2; machineIndex++) {
      const status = faker.helpers.arrayElement(["online", "online", "online", "offline", "error"] as const);

      const machine = await prisma.machine.create({
        data: {
          tenantId: tenant.id,
          siteId: site.id,
          serialNumber: generateSerialNumber(),
          name: `VM-${faker.string.alphanumeric({ length: 5, casing: "upper" })}`,
          description: faker.company.catchPhrase(),
          status,
          lastConnectionEventAt: faker.date.recent({ days: 3 }),
        },
      });

      // The same product may sit in more than one slot, as it does in a real machine.
      // Slots are 1-based to match the device (prices.h), so the layout's array
      // index (0-based) is never the slot number on its own.
      const slots = await Promise.all(
        generateSlotLayout().map((row, index) => {
          const product = faker.helpers.arrayElement(products);
          return prisma.slot.create({
            data: {
              machineId: machine.id,
              productId: product.id,
              slotNumber: index + 1,
              ...toSlotRect(row),
              quantity: 0,
              capacity: slotCapacity(row),
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

/**
 * Machines that haven't been given to a tenant yet, for the superadmin's slot layout editor.
 *
 * A site always belongs to a tenant, so these stand at one of the seeded tenant's sites.
 * Slots have no product: the tenant picks those once the machine is theirs.
 */
async function seedMachinesWithoutTenant(siteId: string) {
  const withLayout = await prisma.machine.create({
    data: { siteId, serialNumber: generateSerialNumber(), name: `VM-NEW-${faker.string.alphanumeric({ length: 4, casing: "upper" })}` },
  });
  await prisma.slot.createMany({
    data: generateSlotLayout().map((row, index) => ({
      machineId: withLayout.id,
      slotNumber: index + 1,
      ...toSlotRect(row),
      capacity: slotCapacity(row),
    })),
  });

  // And one with no slots at all, to start a layout from scratch
  await prisma.machine.create({
    data: { siteId, serialNumber: generateSerialNumber(), name: `VM-NEW-${faker.string.alphanumeric({ length: 4, casing: "upper" })}` },
  });
}

async function main() {
  await seedPermissions();

  // The dev data is created with plain inserts, so a second run would collide on the seeded emails
  if (await prisma.user.findUnique({ where: { email: SUPERADMIN_EMAIL } })) {
    console.log("Dev data already seeded; skipping. Run `npx prisma migrate reset` in backend/ to start over.");
    return;
  }

  const superadmin = await createDevUser(SUPERADMIN_EMAIL, "Dev Superadmin");
  await prisma.user.update({ where: { id: superadmin.id }, data: { isSuperAdmin: true } });

  const tenants = await Promise.all(Array.from({ length: 2 }, (_, index) => seedTenant(index + 1)));

  const site = await prisma.site.findFirstOrThrow({ where: { tenantId: tenants[0]!.tenant.id } });
  await seedMachinesWithoutTenant(site.id);

  console.log(`Seeded dev data: superadmin ${SUPERADMIN_EMAIL} (password: ${DEV_PASSWORD})`);
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
