import {
  deleteSiteService,
  getSiteByIdService,
  getSitesPageService,
  getSitesService,
  simpleSiteSearchService,
  updateSiteService,
} from "@/api/services/sites.service";
import { prisma } from "@/lib/prisma";

import { beforeAll, describe, expect, it } from "vitest";

import { type TenantData, createTenantWithData } from "./fixtures";

let a: TenantData;
let b: TenantData;

beforeAll(async () => {
  a = await createTenantWithData("A");
  b = await createTenantWithData("B");
});

describe("sites are isolated between tenants", () => {
  it("lists only the tenant's own sites", async () => {
    const [error, sites] = await getSitesService(a.tenant.id);

    expect(error).toBeNull();
    expect(sites?.map((site) => site.id)).toEqual([a.site.id]);
  });

  it("does not find another tenant's site when searching for its name", async () => {
    const [pageError, page] = await getSitesPageService(a.tenant.id, { search: b.site.name });
    const [searchError, matches] = await simpleSiteSearchService(a.tenant.id, { search: b.site.name });

    expect(pageError).toBeNull();
    expect(page?.totalCount).toBe(0);
    expect(searchError).toBeNull();
    expect(matches).toEqual([]);
  });

  it("reads another tenant's site id as not found", async () => {
    const [error] = await getSiteByIdService(a.tenant.id, b.site.id);

    expect(error?.reason).toBe("SITE_NOT_FOUND");
  });

  it("cannot update another tenant's site", async () => {
    const [error] = await updateSiteService(a.tenant.id, b.site.id, { name: "Overwritten" });

    expect(error?.reason).toBe("SITE_NOT_FOUND");
    expect((await prisma.site.findUniqueOrThrow({ where: { id: b.site.id } })).name).toBe(b.site.name);
  });

  it("cannot delete another tenant's site", async () => {
    const [error] = await deleteSiteService(a.tenant.id, b.site.id);

    expect(error?.reason).toBe("SITE_NOT_FOUND");
    expect(await prisma.site.count({ where: { id: b.site.id } })).toBe(1);
  });
});
