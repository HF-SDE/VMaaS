import { beforeEach, describe, expect, it, vi } from "vitest";

const { siteCount, machineCreate } = vi.hoisted(() => {
  return {
    siteCount: vi.fn(async () => 1),
    machineCreate: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    site: { count: siteCount },
    machine: { create: machineCreate },
  },
}));

import { Prisma } from "@/generated/prisma/client";

import { createMachineService } from "@/api/services/machines.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const MACHINE = "33333333-3333-4333-8333-333333333333";

function machineRow(serialNumber: string) {
  return {
    id: MACHINE,
    serialNumber,
    tenantId: TENANT,
    siteId: SITE,
    name: "VM-001",
    site: { id: SITE, name: "Canteen", city: "Aarhus" },
  };
}

beforeEach(() => {
  siteCount.mockReset();
  machineCreate.mockReset();
  siteCount.mockResolvedValue(1);
});

describe("createMachineService", () => {
  it("generates a serial number rather than taking one from the caller", async () => {
    machineCreate.mockImplementation(async (args: { data: { serialNumber: string } }) =>
      machineRow(args.data.serialNumber),
    );

    const [error, machine] = await createMachineService(TENANT, { name: "VM-001", siteId: SITE });

    expect(error).toBeNull();
    expect(machine?.serialNumber).toMatch(/^VM-[0-9A-F]{8}$/);
    expect(machineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, siteId: SITE }),
      }),
    );
  });

  function serialCollisionError() {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["serialNumber"] },
    });
  }

  it("retries with a fresh serial number when one collides", async () => {
    let attempts = 0;
    machineCreate.mockImplementation(async (args: { data: { serialNumber: string } }) => {
      attempts += 1;
      if (attempts === 1) {
        throw serialCollisionError();
      }
      return machineRow(args.data.serialNumber);
    });

    const [error, machine] = await createMachineService(TENANT, { name: "VM-001", siteId: SITE });

    expect(error).toBeNull();
    expect(attempts).toBe(2);
    expect(machine?.serialNumber).toMatch(/^VM-[0-9A-F]{8}$/);
  });

  it("gives up as UNKNOWN_ERROR rather than looping forever once every retry collides", async () => {
    machineCreate.mockImplementation(async () => {
      throw serialCollisionError();
    });

    const [error, machine] = await createMachineService(TENANT, { name: "VM-001", siteId: SITE });

    // 5 attempts total: MAX_SERIAL_ATTEMPTS in machines.service.ts. Asserted as an
    // exact count, not just "> 1", so exhaustion is what's being tested, not just
    // another retry.
    expect(machineCreate).toHaveBeenCalledTimes(5);
    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(machine).toBeNull();
  });

  it("does not retry a unique-constraint failure on a column other than serialNumber", async () => {
    machineCreate.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["someOtherColumn"] },
      });
    });

    const [error] = await createMachineService(TENANT, { name: "VM-001", siteId: SITE });

    // A single attempt: a collision on any column but `serialNumber` must
    // surface immediately, not be swallowed by the retry loop.
    expect(machineCreate).toHaveBeenCalledTimes(1);
    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });

  it("answers SITE_NOT_FOUND rather than writing when the site is not this tenant's", async () => {
    siteCount.mockResolvedValue(0);

    const [error] = await createMachineService(TENANT, { name: "VM-001", siteId: SITE });

    expect(error?.reason).toBe("SITE_NOT_FOUND");
    expect(machineCreate).not.toHaveBeenCalled();
  });
});
