import * as Sentry from "@sentry/node";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";
import {
  ALERTS_SUMMARY_RECENT_LIMIT,
  ALERT_TYPES,
  type AlertType,
  type AlertsSummary,
  type GetAlertsParams,
  type MachineAlertRow,
} from "@vmaas/shared/types/machineAlert";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT_ORDER = "desc" as const;

export type UnknownAlertError = { reason: "UNKNOWN_ERROR"; message: string };

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
  Sentry.captureException(cause, { tags: { service: "alerts", action } });
  console.error(`[alerts.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the alerts.`,
  });
}

export function clampAlertPaging(params: GetAlertsParams): { page: number; pageSize: number } {
  return {
    page: Math.max(0, Math.trunc(params.page ?? 0)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE))),
  };
}

export function buildAlertWhere(tenantId: string, params: GetAlertsParams): Prisma.SecurityAlertWhereInput {
  const search = params.search?.trim();

  const machine: Prisma.MachineWhereInput = { tenantId };
  if (params.siteIds?.length) machine.siteId = { in: params.siteIds };

  const where: Prisma.SecurityAlertWhereInput = { machine };

  if (params.machineIds?.length) where.machineId = { in: params.machineIds };
  if (params.alertTypes?.length) where.type = { in: params.alertTypes };

  const occurredAt: Prisma.DateTimeFilter = {};
  if (params.dateFrom) occurredAt.gte = new Date(`${params.dateFrom}T00:00:00.000Z`);
  if (params.dateTo) occurredAt.lte = new Date(`${params.dateTo}T23:59:59.999Z`);
  if (occurredAt.gte || occurredAt.lte) where.occurredAt = occurredAt;
  if (search) {
    where.OR = [
      { message: { contains: search, mode: "insensitive" } },
      { machine: { ...machine, name: { contains: search, mode: "insensitive" } } },
      { machine: { ...machine, site: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }

  return where;
}

function toAlertRow(alert: AlertWithMachine): MachineAlertRow | null {
  const site = alert.machine.site;
  if (!site) {
    console.error(`[alerts.service] invariant violated: alert ${alert.id}'s machine ${alert.machineId} has no site`);
    return null;
  }

  return {
    id: alert.id,
    type: alert.type,
    machineId: alert.machineId,
    machineName: alert.machine.name,
    createdAt: alert.createdAt.toISOString(),
    occurredAt: alert.occurredAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    message: alert.message,
    siteId: site.id,
    siteName: site.name,
    contactPhone: site.contactPhone ?? null,
    contactEmail: site.contactEmail ?? null,
  };
}

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
      data: alerts.flatMap((alert) => toAlertRow(alert) ?? []),
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
      totalCount,
    });
  } catch (error) {
    return unknownError("listing", error);
  }
}

export async function getAlertsSummaryService(tenantId: string): Promise<Result<UnknownAlertError, AlertsSummary>> {
  const where: Prisma.SecurityAlertWhereInput = { ...buildAlertWhere(tenantId, {}), resolvedAt: null };

  try {
    const countsByType = prisma.securityAlert.groupBy({
      by: ["type"],
      where,
      orderBy: { type: "asc" },
      _count: { _all: true },
    });

    const recentAlerts = prisma.securityAlert.findMany({
      where,
      select: ALERT_SELECT,
      orderBy: { occurredAt: "desc" },
      take: ALERTS_SUMMARY_RECENT_LIMIT,
    });

    const [grouped, recent] = await prisma.$transaction([countsByType, recentAlerts]);

    const openByType = Object.fromEntries(ALERT_TYPES.map((type) => [type, 0])) as Record<AlertType, number>;
    for (const row of grouped) openByType[row.type] = row._count._all;

    return ok({
      openByType,
      openTotal: ALERT_TYPES.reduce((total, type) => total + openByType[type], 0),
      recent: recent.flatMap((alert) => toAlertRow(alert) ?? []),
    });
  } catch (error) {
    return unknownError("summarising", error);
  }
}

export type AlertNotFoundError = { reason: "ALERT_NOT_FOUND"; message: string };
export type AlertAlreadyResolvedError = { reason: "ALERT_ALREADY_RESOLVED"; message: string };
export type ResolveAlertError = AlertNotFoundError | AlertAlreadyResolvedError | UnknownAlertError;

const ALERT_NOT_FOUND: AlertNotFoundError = {
  reason: "ALERT_NOT_FOUND",
  message: "No open alert with that id belongs to this tenant.",
};

const ALERT_ALREADY_RESOLVED: AlertAlreadyResolvedError = {
  reason: "ALERT_ALREADY_RESOLVED",
  message: "That alert has already been resolved.",
};

/**
 * Raises an alert on a machine and answers the row the alerts page lists, so
 * the caller can push it to the tenant as `alert.created` without re-reading.
 * The row is null when the machine has no site (the invariant toAlertRow
 * guards): the alert is stored, it just cannot be shown yet.
 */
export async function createAlertService(input: {
  machineId: string;
  type: AlertType;
  message: string;
  occurredAt?: Date;
}): Promise<Result<UnknownAlertError, MachineAlertRow | null>> {
  try {
    const alert = await prisma.securityAlert.create({
      data: { machineId: input.machineId, type: input.type, message: input.message, occurredAt: input.occurredAt },
      select: ALERT_SELECT,
    });

    return ok(toAlertRow(alert));
  } catch (error) {
    return unknownError("creating", error);
  }
}

export async function resolveAlertService(
  tenantId: string,
  alertId: string,
): Promise<Result<ResolveAlertError, MachineAlertRow>> {
  try {
    const { count } = await prisma.securityAlert.updateMany({
      where: { id: alertId, resolvedAt: null, machine: { tenantId } },
      data: { resolvedAt: new Date() },
    });

    if (count === 0) {
      const existing = await prisma.securityAlert.count({ where: { id: alertId, machine: { tenantId } } });
      return err(existing > 0 ? ALERT_ALREADY_RESOLVED : ALERT_NOT_FOUND);
    }

    const updated = await prisma.securityAlert.findFirst({
      where: { id: alertId, machine: { tenantId } },
      select: ALERT_SELECT,
    });

    // The row was updated a statement ago, so a miss here means the same
    // machine-has-no-site invariant `toAlertRow` guards, not a missing row.
    const row = updated && toAlertRow(updated);
    if (!row) return err(ALERT_NOT_FOUND);

    return ok(row);
  } catch (error) {
    return unknownError("resolving", error);
  }
}
