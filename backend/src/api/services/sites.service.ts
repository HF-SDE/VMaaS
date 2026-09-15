import { Prisma, type Site } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";
import {
  type GetSitesParams,
  SITE_SORT_FIELDS,
  type SimpleSite,
  type SimpleSiteSearchParams,
  type SiteSortField,
  type SiteUsage,
} from "@vmaas/shared/types/site";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_SORT_BY: SiteSortField = "createdAt";
const DEFAULT_SORT_ORDER = "desc" as const;

/**
 * Every service below answers a `Result` tuple instead of throwing or returning
 * `null`, so each failure the caller has to handle is a named `reason` the
 * controller switches on exhaustively — a new reason then fails to compile
 * until the controller words it.
 */
export type SiteNotFoundError = { reason: "SITE_NOT_FOUND"; message: string };
export type SiteInUseError = { reason: "SITE_IN_USE"; message: string };
export type UnknownSiteError = { reason: "UNKNOWN_ERROR"; message: string };

/** A site row plus the usage fields `getSiteByIdService` derives. */
export type SiteDetail = Site & SiteUsage;

/** The columns a write accepts. The coordinates are geocoder output rather than
 *  typed input, and the schemas hold them to a pair — see
 *  `@vmaas/shared/schemas/sites`. Prisma widens the numbers to `Decimal`. */
export type SiteWriteData = {
  name?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function isSortField(value: string): value is SiteSortField {
  return (SITE_SORT_FIELDS as readonly string[]).includes(value);
}

const SITE_NOT_FOUND: SiteNotFoundError = {
  reason: "SITE_NOT_FOUND",
  message: "The site does not exist.",
};

/**
 * The catch-all for a throw no service anticipated — a dropped connection, a
 * constraint nobody modelled. The thrown value never reaches the response; it
 * is logged here so the caller only has to render one generic failure.
 */
function unknownError(action: string, cause: unknown): Result<UnknownSiteError, never> {
  // TODO: capture sentry error
  console.error(`[sites.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the site.`,
  });
}

export async function getSitesService(tenantId: string): Promise<Result<UnknownSiteError, Site[]>> {
  try {
    return ok(await prisma.site.findMany({ where: { tenantId }, orderBy: { name: "asc" } }));
  } catch (error) {
    return unknownError("listing", error);
  }
}

/**
 * One page of a tenant's sites, with optional search and sorting.
 *
 * Every parameter is clamped or whitelisted rather than rejected, so a stale
 * bookmark (`?page=9999&sortBy=bogus`) still renders instead of erroring. The
 * search covers name and city — the two columns the table shows.
 */
export async function getSitesPageService(
  tenantId: string,
  params: GetSitesParams = {},
): Promise<Result<UnknownSiteError, GetPaginatedResult<Site>>> {
  const page = Math.max(0, Math.trunc(params.page ?? 0));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE)));
  const sortBy = params.sortBy && isSortField(params.sortBy) ? params.sortBy : DEFAULT_SORT_BY;
  const sortOrder = params.sortOrder === "asc" ? "asc" : DEFAULT_SORT_ORDER;
  const search = params.search?.trim();

  const where = {
    tenantId,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { city: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  try {
    const [sites, totalCount] = await prisma.$transaction([
      prisma.site.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: page * pageSize,
        take: pageSize,
      }),
      prisma.site.count({ where }),
    ]);

    return ok({
      data: sites,
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
      totalCount,
    });
  } catch (error) {
    return unknownError("listing", error);
  }
}

export async function createSiteService(
  tenantId: string,
  data: SiteWriteData & { name: string },
): Promise<Result<UnknownSiteError, Site>> {
  try {
    return ok(await prisma.site.create({ data: { ...data, tenantId } }));
  } catch (error) {
    return unknownError("creating", error);
  }
}

/**
 * One site, plus whether anything still references it.
 *
 * Every function below matches on `id` *and* `tenantId`, so a site belonging to
 * another tenant reads as "not found" rather than being served or written.
 */
export async function getSiteByIdService(
  tenantId: string,
  id: string,
): Promise<Result<SiteNotFoundError | UnknownSiteError, SiteDetail>> {
  try {
    const site = await prisma.site.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { machines: true } } },
    });

    if (!site) return err(SITE_NOT_FOUND);

    const { _count, ...rest } = site;

    return ok({ ...rest, machineCount: _count.machines, canDelete: _count.machines === 0 });
  } catch (error) {
    return unknownError("reading", error);
  }
}

export async function updateSiteService(
  tenantId: string,
  id: string,
  data: SiteWriteData,
): Promise<Result<SiteNotFoundError | UnknownSiteError, SiteDetail>> {
  try {
    // updateMany rather than update: it takes the tenant in its filter, where
    // `update` only accepts a unique field and would write across tenants.
    const { count } = await prisma.site.updateMany({ where: { id, tenantId }, data });

    if (count === 0) return err(SITE_NOT_FOUND);
  } catch (error) {
    return unknownError("updating", error);
  }

  return getSiteByIdService(tenantId, id);
}

/**
 * The machine check is done here rather than left to `Machine.site`'s
 * `onDelete: Restrict`: the constraint would surface as an opaque Prisma error,
 * while this reports a case the UI can word for the user. A site has no
 * `archivedAt` to fall back on, so the message has to say what to do instead.
 */
export async function deleteSiteService(
  tenantId: string,
  id: string,
): Promise<Result<SiteNotFoundError | SiteInUseError | UnknownSiteError, { deletedSiteId: string }>> {
  try {
    const site = await prisma.site.findFirst({
      where: { id, tenantId },
      select: { _count: { select: { machines: true } } },
    });
    if (!site) return err(SITE_NOT_FOUND);
    if (site._count.machines > 0)
      return err({
        reason: "SITE_IN_USE",
        message: "The site still has machines.",
      });

    await prisma.site.delete({ where: { id, tenantId } });
    return ok({ deletedSiteId: id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025: the row went away between the check above and the delete.
      if (error.code === "P2025") return err(SITE_NOT_FOUND);

      // P2003: a machine was moved in during the same window, so the restrict
      // constraint fired where the count had said the site was empty.
      if (error.code === "P2003")
        return err({
          reason: "SITE_IN_USE",
          message: "The site still has machines.",
        });
    }

    return unknownError("deleting", error);
  }
}
