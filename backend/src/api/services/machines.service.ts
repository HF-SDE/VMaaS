import { randomBytes } from "node:crypto";

import { type Machine, type Pin, Prisma, type Slot } from "@/generated/prisma/client";
import { kickMqttClient } from "@/lib/emqx";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";
import {
  type GetMachinesParams,
  MACHINE_SORT_FIELDS,
  type MachineKpi,
  type MachineKpis,
  type MachineSite,
  type MachineSortField,
  type MachineUsage,
  type SaveSlotLayoutData,
  type SimpleMachine,
  type SimpleMachineSearchParams,
} from "@vmaas/shared/types/machine";
import type { SimpleSite } from "@vmaas/shared/types/site";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_SORT_BY: MachineSortField = "createdAt";
const DEFAULT_SORT_ORDER = "desc" as const;
const DEFAULT_KPI_DAYS = 30;
const MAX_KPI_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MachineNotFoundError = { reason: "MACHINE_NOT_FOUND"; message: string };
export type MachineInUseError = { reason: "MACHINE_IN_USE"; message: string };
/** A write named a site that is not this tenant's — or does not exist at all. */
export type MachineSiteNotFoundError = { reason: "SITE_NOT_FOUND"; message: string };
export type UnknownMachineError = { reason: "UNKNOWN_ERROR"; message: string };
/** A saved layout named a slot id that isn't one of the machine's slots. */
export type SlotNotFoundError = { reason: "SLOT_NOT_FOUND"; message: string };
/** A layout save would remove a slot that still holds stock. Carries the slot
 *  numbers so the caller can name them; the message already does, but the array
 *  is what a UI would highlight if `HttpError` ever carried response bodies. */
export type SlotsNotEmptyError = { reason: "SLOTS_NOT_EMPTY"; message: string; slots: number[] };

/** A machine row with the site it stands at, as every tenant-scoped read
 *  returns it — see the invariant note on `narrowToSite` below. */
export type MachineListItem = Machine & MachineSite;
export type MachineDetail = MachineListItem & MachineUsage & MachineKpis;

/** What the detail read takes beyond the id — only the KPI window so far. */
export type MachineReadParams = { days?: number };

/** What `getMachineForLayoutService` returns — a machine for the slot layout
 *  editor, claimed or not. It deliberately keeps a nullable site, unlike every
 *  tenant-scoped read, because a factory-registered machine genuinely hasn't
 *  been placed yet, and a claimed one still has to render here. Built from
 *  `Machine` directly rather than from `MachineListItem`, so tightening
 *  `MachineSite` to non-null can never drag this type along with it. Slots
 *  carry their pins so the slot layout editor can show a slot's existing wiring. */
export type MachineForLayout = Machine & { site: SimpleSite | null; slots: (Slot & { pins: Pin[] })[] };

/** What `MachineSite` carries — enough to name the site and link to it. */
const SITE_SELECT = { select: { id: true, name: true, city: true } } as const;

/**
 * Narrows a row with a possibly-null site down to `MachineSite`, or `null` if
 * the invariant ("a machine with a tenant always has a site") doesn't hold for
 * this row.
 *
 * It should always hold — `claimMachineService` sets `tenantId` and `siteId`
 * in the same write, and `createMachineService` sets neither — so a `null` here means
 * something else broke it, not that the caller did anything wrong. Rather than
 * asserting that away with a cast, a violation is treated as absence: dropped
 * from a list, or read as not-found for a single machine. Either is safer than
 * crashing the page or lying about the type.
 */
function narrowToSite<T extends { id: string; site: SimpleSite | null }>(machine: T): (T & MachineSite) | null {
  if (!machine.site) {
    console.error(`[machines.service] invariant violated: machine ${machine.id} has a tenant but no site`);
    return null;
  }
  return { ...machine, site: machine.site };
}

/** The columns a write accepts. `siteId` is checked against the tenant before
 *  it reaches Prisma, so a machine can never be moved to another tenant's site.
 *  No `null`: `updateMachineSchema` takes no `null` either — moving a machine
 *  means naming another site, never clearing the one it stands at. */
export type MachineWriteData = { name?: string; siteId?: string };

function isSortField(value: string): value is MachineSortField {
  return (MACHINE_SORT_FIELDS as readonly string[]).includes(value);
}

const MACHINE_NOT_FOUND: MachineNotFoundError = {
  reason: "MACHINE_NOT_FOUND",
  message: "The machine does not exist.",
};

const MACHINE_IN_USE: MachineInUseError = {
  reason: "MACHINE_IN_USE",
  message: "The machine is in use.",
};

const SLOT_NOT_FOUND: SlotNotFoundError = {
  reason: "SLOT_NOT_FOUND",
  message: "One or more slots do not belong to the machine.",
};

const SITE_NOT_FOUND: MachineSiteNotFoundError = {
  reason: "SITE_NOT_FOUND",
  message: "The site does not exist.",
};

/**
 * Whether the tenant owns the site a write named.
 *
 * `siteId` is the one field on a machine that points at another row the caller
 * chose, so it is the one field that could reach across tenants. The foreign key
 * alone would not stop that — it only asks that the site exist — so membership
 * is checked here and a site belonging to someone else reads as "not found".
 */
async function tenantOwnsSite(tenantId: string, siteId: string): Promise<boolean> {
  return (await prisma.site.count({ where: { id: siteId, tenantId } })) > 0;
}

function unknownError(action: string, cause: unknown): Result<UnknownMachineError, never> {
  console.error(`[machines.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the machine.`,
  });
}

export async function getMachinesService(tenantId: string): Promise<Result<UnknownMachineError, MachineListItem[]>> {
  try {
    const machines = await prisma.machine.findMany({
      // `siteId: { not: null }` on top of the mapper's own narrowing, not
      // instead of it: Prisma's generated type still calls `site` nullable
      // regardless of the filter, so the mapper is what TypeScript actually
      // trusts. The filter just keeps a violation off the wire in the first
      // place, rather than shrinking the array after the fact.
      where: { tenantId, siteId: { not: null } },
      include: { site: SITE_SELECT },
    });

    // A row that fails the narrow despite the filter would mean the
    // invariant broke between the filter and the read — vanishingly
    // unlikely, but dropped rather than trusted either way.
    return ok(machines.flatMap((machine) => narrowToSite(machine) ?? []));
  } catch (error) {
    return unknownError("listing", error);
  }
}

export async function getMachinesPageService(
  tenantId: string,
  params: GetMachinesParams = {},
): Promise<Result<UnknownMachineError, GetPaginatedResult<MachineListItem>>> {
  const page = Math.max(0, Math.trunc(params.page ?? 0));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE)));
  const sortBy = params.sortBy && isSortField(params.sortBy) ? params.sortBy : DEFAULT_SORT_BY;
  const sortOrder = params.sortOrder === "asc" ? "asc" : DEFAULT_SORT_ORDER;
  const search = params.search?.trim();

  // The site is a column in the table, so it is searchable like the name is —
  // typing a site's name finds the machines standing there. `siteId: { not:
  // null }` is the same invariant-defending filter as the unpaged list.
  const where = {
    tenantId,
    siteId: { not: null } as const,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { site: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  // `site` is the site's name, not the `siteId` column — sorting by the uuid
  // would put the rows in an order that means nothing to a reader.
  // Annotated rather than inferred: the union of the two branches widens
  // `sortOrder` back to `string`, which Prisma's `SortOrder` will not take.
  const orderBy: Prisma.MachineOrderByWithRelationInput =
    sortBy === "site" ? { site: { name: sortOrder } } : { [sortBy]: sortOrder };

  try {
    const [machines, totalCount] = await prisma.$transaction([
      prisma.machine.findMany({
        where,
        include: { site: SITE_SELECT },
        orderBy,
        skip: page * pageSize,
        take: pageSize,
      }),
      prisma.machine.count({ where }),
    ]);

    return ok({
      data: machines.flatMap((machine) => narrowToSite(machine) ?? []),
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
      totalCount,
    });
  } catch (error) {
    return unknownError("listing", error);
  }
}

export async function getMachinesWithoutTenantService() {
  const machines = await prisma.machine.findMany({
    where: { tenantId: null },
    include: { site: SITE_SELECT, slots: true },
    orderBy: { name: "asc" },
  });

  return machines;
}

/**
 * One machine for the slot layout editor, claimed or not.
 *
 * It deliberately does NOT filter on `tenantId`. The layout describes the
 * cabinet's physics — how many slots there are, how big they are, and which
 * GPIO drives each motor — which is a property of the hardware rather than of
 * whoever owns it. A cabinet rebuilt in the field belongs to a tenant by then,
 * and had no way to be re-described while this read filtered them out.
 *
 * Authorisation is the route's job: `requireSuperAdmin` guards it, so opening
 * this read does not widen who may see a machine.
 */
export async function getMachineForLayoutService(
  id: string,
): Promise<Result<MachineNotFoundError | UnknownMachineError, MachineForLayout>> {
  try {
    const machine = await prisma.machine.findFirst({
      where: { id },
      include: {
        site: SITE_SELECT,
        slots: {
          orderBy: { slotNumber: "asc" },
          include: { pins: { orderBy: { number: "asc" } } },
        },
      },
    });

    if (!machine) return err(MACHINE_NOT_FOUND);

    return ok(machine);
  } catch (error) {
    return unknownError("reading", error);
  }
}

/**
 * Replaces a machine's slots with the layout from the editor, in one transaction.
 *
 * The body is the whole layout, and the rules it has to follow (inside the grid, no overlaps,
 * no floating slots, unique slot numbers) were already checked by `saveSlotLayoutSchema`.
 * What's left for here is what needs the database:
 * - slots with an id must be slots of this machine
 * - stored slots missing from the layout are deleted
 * - slots with an id are updated, slots without one are created
 * - the machine's stepsPerVend is written
 *
 * `columns` and `rows` are validated but not stored yet: `Machine` has no columns for them.
 */
export async function saveSlotLayoutService(
  data: SaveSlotLayoutData,
): Promise<Result<MachineNotFoundError | SlotNotFoundError | SlotsNotEmptyError | UnknownMachineError, Slot[]>> {
  try {
    const machine = await prisma.machine.findUnique({
      where: { id: data.machineId },
      select: { id: true, slots: { select: { id: true, slotNumber: true, quantity: true } } },
    });
    if (!machine) return err(MACHINE_NOT_FOUND);


    const machineId = machine.id;

    const storedIds = new Set(machine.slots.map((slot) => slot.id));
    const keptSlots = data.slots.filter((slot) => slot.id !== undefined);
    const newSlots = data.slots.filter((slot) => slot.id === undefined);

    // Without this check an id from another machine would move that slot over here
    if (keptSlots.some((slot) => !storedIds.has(slot.id!))) return err(SLOT_NOT_FOUND);

    const keptIds = new Set(keptSlots.map((slot) => slot.id!));
    const removedIds = [...storedIds].filter((id) => !keptIds.has(id));

    const removed = machine.slots.filter((slot) => removedIds.includes(slot.id));
    const stillStocked = removed.filter((slot) => slot.quantity > 0).map((slot) => slot.slotNumber);

    if (stillStocked.length > 0) {
      return err({
        reason: "SLOTS_NOT_EMPTY",
        message: `These slots still hold stock and cannot be removed: ${stillStocked.map((n) => `#${n}`).join(", ")}`,
        slots: stillStocked,
      });
    }

    const slots = await prisma.$transaction(async (tx) => {
      // The pulse count belongs to the machine, not to a slot, and is saved in
      // the same transaction so a publish never sees a layout from one save and
      // a step count from another.
      await tx.machine.update({ where: { id: machineId }, data: { stepsPerVend: data.stepsPerVend } });

      await tx.slot.deleteMany({ where: { machineId, id: { in: removedIds } } });

      // Slot numbers are unique per machine and checked on every write, so renumbering in
      // place fails when two slots swap numbers. Moving the kept slots to temporary negative
      // numbers first frees up every number the layout uses.
      for (const [index, slot] of keptSlots.entries()) {
        await tx.slot.update({ where: { id: slot.id }, data: { slotNumber: -(index + 1) } });
      }

      for (const { id, pins: _keptPins, ...slot } of keptSlots) {
        await tx.slot.update({ where: { id }, data: slot });
      }

      if (newSlots.length > 0) {
        await tx.slot.createMany({
          data: newSlots.map(({ pins: _newPins, ...slot }) => ({ ...slot, machineId })),
        });
      }

      await tx.pin.deleteMany({ where: { machineId } });

      const stored = await tx.slot.findMany({
        where: { machineId },
        select: { id: true, slotNumber: true },
      });
      const slotIdByNumber = new Map(stored.map((slot) => [slot.slotNumber, slot.id]));

      const pinRows = data.slots.flatMap((slot) =>
        slot.pins.map((pin) => ({
          machineId,
          slotId: slotIdByNumber.get(slot.slotNumber)!,
          number: pin.number,
          description: pin.description,
        })),
      );

      if (pinRows.length > 0) {
        await tx.pin.createMany({ data: pinRows });
      }

      return tx.slot.findMany({ where: { machineId }, orderBy: { slotNumber: "asc" } });
    });

    return ok(slots);
  } catch (error) {
    return unknownError("saving the slot layout of", error);
  }
}

/**
 * A short list of matching machines for a picker — id, name and site only.
 *
 * Deliberately not a page: a picker shows the first handful and asks the user to
 * type more, so there is no count to run and no offset to carry. `limit` is
 * clamped rather than rejected for the same reason the paginated list clamps.
 * The site is searched alongside the name, as it is in the paginated list.
 */
export async function simpleMachineSearchService(
  tenantId: string,
  params: SimpleMachineSearchParams,
): Promise<Result<UnknownMachineError, SimpleMachine[]>> {
  const search = params.search.trim();
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(params.limit ?? DEFAULT_SEARCH_LIMIT)));

  try {
    const machines = await prisma.machine.findMany({
      where: {
        tenantId,
        siteId: { not: null },
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { site: { name: { contains: search, mode: "insensitive" } } },
        ],
      },
      select: { id: true, name: true, site: SITE_SELECT },
      orderBy: { name: "asc" },
      take: limit,
    });

    return ok(machines.flatMap((machine) => narrowToSite(machine) ?? []));
  } catch (error) {
    return unknownError("searching", error);
  }
}

/** No physical hardware behind a machine created this way, so there is no
 *  factory-etched serial to record — a short readable one is minted instead.
 *  8 hex characters is 2^32 combinations, checked against the real
 *  possibility of a collision below rather than assumed away. */
const SERIAL_PREFIX = "VM-";
const SERIAL_RANDOM_BYTES = 4;
const MAX_SERIAL_ATTEMPTS = 5;

/** Exported so seeds mint serials the same way real writes do — one
 *  definition of what a generated serial looks like, not two. */
export function generateSerialNumber(): string {
  return `${SERIAL_PREFIX}${randomBytes(SERIAL_RANDOM_BYTES).toString("hex").toUpperCase()}`;
}

/** Whether a `P2002` is *this* write colliding on `serialNumber` specifically,
 *  rather than some other unique constraint. `Machine` only has the one today,
 *  but retrying blindly would silently paper over a future one instead of
 *  surfacing it. */
function isSerialNumberCollision(error: Prisma.PrismaClientKnownRequestError): boolean {
  const target = error.meta?.target;
  const targets = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return targets.includes("serialNumber");
}

/**
 * Superadmin only. The machine is created with neither a tenant nor a site, so
 * it shows up in the "without tenant" list for its slot layout to be set up,
 * and is later bound to a tenant and a site together by `claimMachineService`.
 */
export async function createMachineService(data: { name: string }): Promise<Result<UnknownMachineError, Machine>> {
  try {
    // A generated serial colliding with an existing one is vanishingly
    // unlikely at 2^32 combinations, but retried with a fresh one rather than
    // surfaced as a 500 the caller can do nothing about.
    for (let attempt = 0; attempt < MAX_SERIAL_ATTEMPTS; attempt++) {
      try {
        const machine = await prisma.machine.create({
          data: { name: data.name, serialNumber: generateSerialNumber() },
        });

        return ok(machine);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002" &&
          isSerialNumberCollision(error)
        ) {
          continue;
        }
        throw error;
      }
    }

    return unknownError("creating", new Error("could not generate a unique serial number"));
  } catch (error) {
    return unknownError("creating", error);
  }
}

export function clampKpiDays(days?: number): number {
  return Math.min(MAX_KPI_DAYS, Math.max(1, Math.trunc(days ?? DEFAULT_KPI_DAYS)));
}

async function readMachineKpi(tenantId: string, machineId: string, days: number): Promise<MachineKpi> {
  const since = new Date(Date.now() - days * MS_PER_DAY);
  const previousSince = new Date(Date.now() - days * 2 * MS_PER_DAY);

  // Only completed sales: a pending or failed one is not money the machine
  // took, so counting it would overstate both figures on the card.
  const sold = (from: Date, to?: Date): Prisma.SaleWhereInput => ({
    tenantId,
    machineId,
    status: "completed",
    createdAt: to ? { gte: from, lt: to } : { gte: from },
  });

  const [sales, previousSales, slots, emptySlots, openAlerts, alerts, previousAlerts, lastSale] =
    await prisma.$transaction([
      prisma.sale.aggregate({ where: sold(since), _sum: { price: true }, _count: true }),
      prisma.sale.aggregate({ where: sold(previousSince, since), _sum: { price: true }, _count: true }),
      prisma.slot.aggregate({ where: { machineId }, _sum: { quantity: true, capacity: true }, _count: true }),
      prisma.slot.count({ where: { machineId, quantity: 0 } }),
      prisma.securityAlert.count({ where: { machineId, resolvedAt: null } }),
      prisma.securityAlert.count({ where: { machineId, occurredAt: { gte: since } } }),
      prisma.securityAlert.count({ where: { machineId, occurredAt: { gte: previousSince, lt: since } } }),
      prisma.sale.findFirst({
        where: { tenantId, machineId, status: "completed" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  return {
    days,
    since,
    sales: {
      // `_sum` is null when nothing matched, and a Decimal otherwise — both
      // become a plain number so the card can format one type, not two.
      revenue: { current: Number(sales._sum.price ?? 0), previous: Number(previousSales._sum.price ?? 0) },
      count: { current: sales._count, previous: previousSales._count },
    },
    stock: {
      slots: slots._count,
      quantity: slots._sum.quantity ?? 0,
      capacity: slots._sum.capacity ?? 0,
      emptySlots,
    },
    alerts: { open: openAlerts, logged: { current: alerts, previous: previousAlerts } },
    lastSaleAt: lastSale?.createdAt ?? null,
  };
}

export async function getMachineByIdService(
  tenantId: string,
  id: string,
  params: MachineReadParams = {},
): Promise<Result<MachineNotFoundError | UnknownMachineError, MachineDetail>> {
  try {
    // A tenant-scoped machine with no site would violate the invariant this
    // read's type relies on; filtered here so it reads as not-found rather
    // than reaching the narrow below at all.
    const machine = await prisma.machine.findFirst({
      where: { id, tenantId, siteId: { not: null } },
      include: { site: SITE_SELECT, _count: { select: { slots: true, sales: true } } },
    });

    if (!machine) return err(MACHINE_NOT_FOUND);

    const withSite = narrowToSite(machine);
    if (!withSite) return err(MACHINE_NOT_FOUND);

    const { _count, ...rest } = withSite;

    // After the 404, not beside it: there is no point costing eight queries for
    // a machine this tenant cannot see.
    const kpi = await readMachineKpi(tenantId, id, clampKpiDays(params.days));

    return ok({ ...rest, canDelete: _count.slots + _count.sales === 0, kpi });
  } catch (error) {
    return unknownError("reading", error);
  }
}

export async function updateMachineService(
  tenantId: string,
  id: string,
  data: MachineWriteData,
): Promise<Result<MachineNotFoundError | MachineSiteNotFoundError | UnknownMachineError, MachineDetail>> {
  try {
    // Only when the write moves the machine: an update that just renames it
    // should not pay for a lookup, and has no site to vouch for.
    if (data.siteId !== undefined && !(await tenantOwnsSite(tenantId, data.siteId))) return err(SITE_NOT_FOUND);

    // updateMany rather than update: it takes the tenant in its filter, where
    // `update` only accepts a unique field and would write across tenants.
    const { count } = await prisma.machine.updateMany({ where: { id, tenantId }, data });

    if (count === 0) return err(MACHINE_NOT_FOUND);
  } catch (error) {
    return unknownError("updating", error);
  }

  return getMachineByIdService(tenantId, id);
}

export type DisableMachineResult = { machineId: string; kicked: boolean };

/**
 * Disabling is database state checked on every use: `requireMachine` and the
 * authn webhook both read it, so HTTP and new MQTT connections stop at once.
 * The kick handles the session that is already open.
 */
export async function disableMachineService(
  tenantId: string,
  machineId: string,
  input: { reason: string; revokeCertificate: boolean },
): Promise<Result<MachineNotFoundError | UnknownMachineError, DisableMachineResult>> {
  try {
    // Compound filter: a machine belonging to another tenant must read as not
    // found, never as forbidden — the caller learns nothing about it either way.
    const machine = await prisma.machine.findFirst({
      where: { id: machineId, tenantId },
      select: { id: true },
    });

    if (!machine) return err(MACHINE_NOT_FOUND);

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.machine.update({
        where: { id: machineId },
        data: { disabledAt: now, disabledReason: input.reason },
      });

      // All of the machine's unrevoked certificates, not just one — a
      // rotation could in principle leave more than one live.
      if (input.revokeCertificate) {
        await tx.machineCertificate.updateMany({
          where: { machineId, revokedAt: null },
          data: { revokedAt: now, revokedReason: input.reason },
        });
      }
    });

    // Reported, not thrown: the machine is disabled either way, and the caller
    // needs to know whether a live session survived. A broker that is down
    // must not turn an otherwise-successful disable into a failed request.
    const kicked = await kickMqttClient(machineId);

    return ok({ machineId, kicked });
  } catch (error) {
    return unknownError("disabling", error);
  }
}

export async function deleteMachineService(
  tenantId: string,
  id: string,
): Promise<Result<MachineNotFoundError | MachineInUseError | UnknownMachineError, { deletedMachineId: string }>> {
  try {
    const machine = await prisma.machine.findFirst({
      where: { id, tenantId },
      select: { _count: { select: { slots: true, sales: true } } },
    });
    if (!machine) return err(MACHINE_NOT_FOUND);
    if (machine._count.slots + machine._count.sales > 0) return err(MACHINE_IN_USE);

    await prisma.machine.delete({ where: { id, tenantId } });

    return ok({ deletedMachineId: id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return err(MACHINE_NOT_FOUND);
      if (error.code === "P2003") return err(MACHINE_IN_USE);
    }

    return unknownError("deleting", error);
  }
}
