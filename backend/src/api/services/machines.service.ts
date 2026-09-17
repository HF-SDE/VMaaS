import { type Machine, Prisma } from "@/generated/prisma/client";
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
  type SimpleMachine,
  type SimpleMachineSearchParams,
} from "@vmaas/shared/types/machine";

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

/** A machine row with the site it stands at, as every read returns it. */
export type MachineListItem = Machine & MachineSite;
export type MachineDetail = MachineListItem & MachineUsage & MachineKpis;

/** What the detail read takes beyond the id — only the KPI window so far. */
export type MachineReadParams = { days?: number };

/** What `MachineSite` carries — enough to name the site and link to it. */
const SITE_SELECT = { select: { id: true, name: true, city: true } } as const;

/** The columns a write accepts. `siteId` is checked against the tenant before it
 *  reaches Prisma, so a machine can never be moved to another tenant's site. */
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
    return ok(await prisma.machine.findMany({ where: { tenantId }, include: { site: SITE_SELECT } }));
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
  // typing a site's name finds the machines standing there.
  const where = {
    tenantId,
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
      data: machines,
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
      totalCount,
    });
  } catch (error) {
    return unknownError("listing", error);
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
    return ok(
      await prisma.machine.findMany({
        where: {
          tenantId,
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { site: { name: { contains: search, mode: "insensitive" } } },
          ],
        },
        select: { id: true, name: true, site: SITE_SELECT },
        orderBy: { name: "asc" },
        take: limit,
      }),
    );
  } catch (error) {
    return unknownError("searching", error);
  }
}

export async function createMachineService(
  tenantId: string,
  data: { name: string; siteId: string },
): Promise<Result<MachineSiteNotFoundError | UnknownMachineError, MachineListItem>> {
  try {
    if (!(await tenantOwnsSite(tenantId, data.siteId))) return err(SITE_NOT_FOUND);

    return ok(await prisma.machine.create({ data: { ...data, tenantId }, include: { site: SITE_SELECT } }));
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
    const machine = await prisma.machine.findFirst({
      where: { id, tenantId },
      include: { site: SITE_SELECT, _count: { select: { slots: true, sales: true } } },
    });

    if (!machine) return err(MACHINE_NOT_FOUND);

    const { _count, ...rest } = machine;

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
