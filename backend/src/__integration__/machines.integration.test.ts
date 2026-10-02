import {
  deleteMachineService,
  getMachineByIdService,
  getMachinesPageService,
  getMachinesService,
  simpleMachineSearchService,
  updateMachineService,
} from "@/api/services/machines.service";
import { prisma } from "@/lib/prisma";

import { beforeAll, describe, expect, it } from "vitest";

import { type TenantData, createTenantWithData } from "./fixtures";

let a: TenantData;
let b: TenantData;

beforeAll(async () => {
  a = await createTenantWithData("A");
  b = await createTenantWithData("B");
});

describe("machines are isolated between tenants", () => {
  it("lists only the tenant's own machines", async () => {
    const [error, machines] = await getMachinesService(a.tenant.id);

    expect(error).toBeNull();
    expect(machines?.map((machine) => machine.id)).toEqual([a.machine.id]);
  });

  it("does not find another tenant's machine when searching for its name", async () => {
    const [pageError, page] = await getMachinesPageService(a.tenant.id, { search: b.machine.name });
    const [searchError, matches] = await simpleMachineSearchService(a.tenant.id, { search: b.machine.name });

    expect(pageError).toBeNull();
    expect(page?.totalCount).toBe(0);
    expect(searchError).toBeNull();
    expect(matches).toEqual([]);
  });

  it("reads the tenant's own machine", async () => {
    const [error, machine] = await getMachineByIdService(a.tenant.id, a.machine.id);

    expect(error).toBeNull();
    expect(machine?.id).toBe(a.machine.id);
  });

  it("reads another tenant's machine id as not found", async () => {
    const [error] = await getMachineByIdService(a.tenant.id, b.machine.id);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
  });

  it("cannot rename another tenant's machine", async () => {
    const [error] = await updateMachineService(a.tenant.id, b.machine.id, { name: "Overwritten" });

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: b.machine.id } })).name).toBe(b.machine.name);
  });

  it("cannot move its own machine to another tenant's site", async () => {
    const [error] = await updateMachineService(a.tenant.id, a.machine.id, { siteId: b.site.id });

    expect(error?.reason).toBe("SITE_NOT_FOUND");
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: a.machine.id } })).siteId).toBe(a.site.id);
  });

  it("cannot delete another tenant's machine", async () => {
    const [error] = await deleteMachineService(a.tenant.id, b.machine.id);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
    expect(await prisma.machine.count({ where: { id: b.machine.id } })).toBe(1);
  });
});
