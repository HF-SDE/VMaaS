import { Prisma, type Machine } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";
import {
  type GetMachinesParams,
  MACHINE_SORT_FIELDS,
  type MachineSortField,
  type MachineUsage,
} from "@vmaas/shared/types/machine";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT_BY: MachineSortField = "createdAt";
const DEFAULT_SORT_ORDER = "desc" as const;

export type MachineNotFoundError = { reason: "MACHINE_NOT_FOUND"; message: string };
export type MachineInUseError = { reason: "MACHINE_IN_USE"; message: string };
export type UnknownMachineError = { reason: "UNKNOWN_ERROR"; message: string };

export type MachineDetail = Machine & MachineUsage;

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

function unknownError(action: string, cause: unknown): Result<UnknownMachineError, never> {
  console.error(`[machines.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the machine.`,
  });
}

export async function getMachinesService(tenantId: string): Promise<Result<UnknownMachineError, Machine[]>> {
  try {
    return ok(await prisma.machine.findMany({ where: { tenantId } }));
  } catch (error) {
    return unknownError("listing", error);
  }
}

export async function getMachinesPageService(
  tenantId: string,
  params: GetMachinesParams = {},
): Promise<Result<UnknownMachineError, GetPaginatedResult<Machine>>> {
  const page = Math.max(0, Math.trunc(params.page ?? 0));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE)));
  const sortBy = params.sortBy && isSortField(params.sortBy) ? params.sortBy : DEFAULT_SORT_BY;
  const sortOrder = params.sortOrder === "asc" ? "asc" : DEFAULT_SORT_ORDER;
  const search = params.search?.trim();

  const where = {
    tenantId,
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };

  try {
    const [machines, totalCount] = await prisma.$transaction([
      prisma.machine.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
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

export async function createMachineService(
  tenantId: string,
  name: string,
  location?: string,
): Promise<Result<UnknownMachineError, Machine>> {
  try {
    return ok(await prisma.machine.create({ data: { tenantId, name, location } }));
  } catch (error) {
    return unknownError("creating", error);
  }
}

export async function getMachineByIdService(
  tenantId: string,
  id: string,
): Promise<Result<MachineNotFoundError | UnknownMachineError, MachineDetail>> {
  try {
    const machine = await prisma.machine.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { slots: true, sales: true } } },
    });

    if (!machine) return err(MACHINE_NOT_FOUND);

    const { _count, ...rest } = machine;

    return ok({ ...rest, canDelete: _count.slots + _count.sales === 0 });
  } catch (error) {
    return unknownError("reading", error);
  }
}

export async function updateMachineService(
  tenantId: string,
  id: string,
  // `location: null` clears the column; `undefined` leaves it as it was.
  data: { name?: string; location?: string | null },
): Promise<Result<MachineNotFoundError | UnknownMachineError, MachineDetail>> {
  try {
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
