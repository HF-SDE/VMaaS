import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";
import type { GetAlertsParams, MachineAlertRow } from "@vmaas/shared/types/machineAlert";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT_ORDER = "desc" as const;

export type UnknownAlertError = { reason: "UNKNOWN_ERROR"; message: string };

/**
 * The columns a row needs, joined down to the two names the table prints and
 * the contact details the expanded row shows. Selected rather than included so
 * the rest of the machine and the site never cross the wire.
 */
const ALERT_SELECT = {
  id: true,
  type: true,
  message: true,
  createdAt: true,
  occurredAt: true,
  resolvedAt: true,
  machineId: true,
  machine: {
    select: {
      name: true,
      site: { select: { id: true, name: true, contactPhone: true, contactEmail: true } },
    },
  },
} as const;

type AlertWithMachine = Prisma.SecurityAlertGetPayload<{ select: typeof ALERT_SELECT }>;

function unknownError(action: string, cause: unknown): Result<UnknownAlertError, never> {
  // TODO: capture sentry error
  console.error(`[alerts.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the alerts.`,
  });
}

/**
 * Page and size, clamped rather than rejected.
 *
 * A log is something people bookmark and come back to, so a saved page number
 * that has since fallen off the end should render an empty page instead of a
 * 400. Exported for its own test — it is the half of the read that has no
 * database in it.
 */
export function clampAlertPaging(params: GetAlertsParams): { page: number; pageSize: number } {
  return {
    page: Math.max(0, Math.trunc(params.page ?? 0)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE))),
  };
}

/**
 * The `where` for one alert query.
 *
 * `machine: { tenantId }` is the tenant boundary and is written first and
 * unconditionally: `SecurityAlert` has no `tenantId` of its own, so the join to
 * the machine is the only thing keeping one tenant's log out of another's. The
 * caller's `machineIds` and `siteIds` narrow *within* that filter rather than
 * replacing it, so an id belonging to someone else matches nothing instead of
 * leaking a row.
 *
 * Exported so the filter logic can be asserted directly, without a database.
 */
export function buildAlertWhere(tenantId: string, params: GetAlertsParams): Prisma.SecurityAlertWhereInput {
  const search = params.search?.trim();

  const machine: Prisma.MachineWhereInput = { tenantId };
  if (params.siteIds?.length) machine.siteId = { in: params.siteIds };

  const where: Prisma.SecurityAlertWhereInput = { machine };

  if (params.machineIds?.length) where.machineId = { in: params.machineIds };
  if (params.alertTypes?.length) where.type = { in: params.alertTypes };

  // Both bounds are inclusive whole days, read in UTC: the filter comes from a
  // `<input type="date">`, which has no time and no zone to offer. `dateTo`
  // therefore has to reach the end of its day, or picking the same date in both
  // boxes would select nothing.
  const occurredAt: Prisma.DateTimeFilter = {};
  if (params.dateFrom) occurredAt.gte = new Date(`${params.dateFrom}T00:00:00.000Z`);
  if (params.dateTo) occurredAt.lte = new Date(`${params.dateTo}T23:59:59.999Z`);
  if (occurredAt.gte || occurredAt.lte) where.occurredAt = occurredAt;

  // The machine and the site are columns in the table, so they are searchable
  // alongside the message — typing a site's name finds everything that happened
  // there, the same way the machines list searches its site.
  if (search) {
    where.OR = [
      { message: { contains: search, mode: "insensitive" } },
      { machine: { ...machine, name: { contains: search, mode: "insensitive" } } },
      { machine: { ...machine, site: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }

  return where;
}

/** Joined row → the flat, JSON-shaped row the client is typed against. */
function toAlertRow(alert: AlertWithMachine): MachineAlertRow {
  return {
    id: alert.id,
    type: alert.type,
    machineId: alert.machineId,
    machineName: alert.machine.name,
    createdAt: alert.createdAt.toISOString(),
    occurredAt: alert.occurredAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    message: alert.message,
    siteId: alert.machine.site.id,
    siteName: alert.machine.site.name,
    contactPhone: alert.machine.site.contactPhone,
    contactEmail: alert.machine.site.contactEmail,
  };
}

/**
 * One page of the tenant's machine alerts, newest first.
 *
 * Sorted on `occurredAt` rather than `createdAt`: a machine that was offline
 * reports what it buffered once it is back, so the order rows were written in
 * is not the order the incidents happened in.
 */
export async function getAlertsPageService(
  tenantId: string,
  params: GetAlertsParams = {},
): Promise<Result<UnknownAlertError, GetPaginatedResult<MachineAlertRow>>> {
  const { page, pageSize } = clampAlertPaging(params);
  const sortOrder = params.sortOrder === "asc" ? "asc" : DEFAULT_SORT_ORDER;
  const where = buildAlertWhere(tenantId, params);

  try {
    const [alerts, totalCount] = await prisma.$transaction([
      prisma.securityAlert.findMany({
        where,
        select: ALERT_SELECT,
        orderBy: { occurredAt: sortOrder },
        skip: page * pageSize,
        take: pageSize,
      }),
      prisma.securityAlert.count({ where }),
    ]);

    return ok({
      data: alerts.map(toAlertRow),
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
      totalCount,
    });
  } catch (error) {
    return unknownError("listing", error);
  }
}
