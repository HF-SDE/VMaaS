import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineCreate } = vi.hoisted(() => {
  return {
    machineCreate: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { create: machineCreate },
  },
}));

import { Prisma } from "@/generated/prisma/client";

import { createMachineService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";

function machineRow(serialNumber: string) {
  return {
    id: MACHINE,
    serialNumber,
    tenantId: null,
    siteId: null,
    name: "VM-001",
  };
}

beforeEach(() => {
  machineCreate.mockReset();
});

describe("createMachineService", () => {
  it("generates a serial number rather than taking one from the caller", async () => {
    machineCreate.mockImplementation(async (args: { data: { serialNumber: string } }) =>
      machineRow(args.data.serialNumber),
    );

    const [error, machine] = await createMachineService({ name: "VM-001" });

    expect(error).toBeNull();
    expect(machine?.serialNumber).toMatch(/^VM-[0-9A-F]{8}$/);
  });

  it("creates the machine without a tenant or a site, whatever else the body carries", async () => {
    machineCreate.mockImplementation(async (args: { data: { serialNumber: string } }) =>
      machineRow(args.data.serialNumber),
    );

    const body = { name: "VM-001", tenantId: "11111111-1111-4111-8111-111111111111" };
    await createMachineService(body);

    const { data } = machineCreate.mock.calls[0][0];
    expect(data).toEqual({ name: "VM-001", serialNumber: expect.stringMatching(/^VM-/) });
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

    const [error, machine] = await createMachineService({ name: "VM-001" });

    expect(error).toBeNull();
    expect(attempts).toBe(2);
    expect(machine?.serialNumber).toMatch(/^VM-[0-9A-F]{8}$/);
  });

  it("gives up as UNKNOWN_ERROR rather than looping forever once every retry collides", async () => {
    machineCreate.mockImplementation(async () => {
      throw serialCollisionError();
    });

    const [error, machine] = await createMachineService({ name: "VM-001" });

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

    const [error] = await createMachineService({ name: "VM-001" });

    // A single attempt: a collision on any column but `serialNumber` must
    // surface immediately, not be swallowed by the retry loop.
    expect(machineCreate).toHaveBeenCalledTimes(1);
    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});
