import { beforeEach, describe, expect, it, vi } from "vitest";

const { kickMqttClientMock, findFirst, machineUpdate, certUpdateMany, transaction } = vi.hoisted(() => {
  const findFirst = vi.fn();
  const machineUpdate = vi.fn(async () => ({}));
  const certUpdateMany = vi.fn(async () => ({ count: 0 }));
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      machine: { update: machineUpdate },
      machineCertificate: { updateMany: certUpdateMany },
    }),
  );
  return { kickMqttClientMock: vi.fn(async () => true), findFirst, machineUpdate, certUpdateMany, transaction };
});

vi.mock("@/lib/emqx", () => ({ kickMqttClient: kickMqttClientMock }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findFirst },
    $transaction: transaction,
  },
}));

import { disableMachineService } from "@/api/services/machines.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const MACHINE = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  findFirst.mockReset();
  machineUpdate.mockReset();
  certUpdateMany.mockReset();
  transaction.mockClear();
  kickMqttClientMock.mockReset();

  findFirst.mockResolvedValue({ id: MACHINE });
  machineUpdate.mockResolvedValue({});
  certUpdateMany.mockResolvedValue({ count: 0 });
  kickMqttClientMock.mockResolvedValue(true);
});

describe("disableMachineService", () => {
  it("disables the machine and answers kicked: true", async () => {
    const [error, result] = await disableMachineService(TENANT, MACHINE, {
      reason: "malfunctioning",
      revokeCertificate: false,
    });

    expect(error).toBeNull();
    expect(result).toEqual({ machineId: MACHINE, kicked: true });
    expect(machineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MACHINE },
        data: expect.objectContaining({ disabledReason: "malfunctioning" }),
      }),
    );
  });

  it("looks the machine up scoped by BOTH id and tenantId", async () => {
    await disableMachineService(TENANT, MACHINE, { reason: "r", revokeCertificate: false });

    const args = findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ id: MACHINE, tenantId: TENANT });
  });

  it("answers MACHINE_NOT_FOUND for a machine belonging to another tenant, never forbidden", async () => {
    findFirst.mockResolvedValue(null);

    const [error] = await disableMachineService(OTHER_TENANT, MACHINE, {
      reason: "r",
      revokeCertificate: false,
    });

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
    // No write happens for a machine this tenant cannot see.
    expect(machineUpdate).not.toHaveBeenCalled();
  });

  it("answers MACHINE_NOT_FOUND for an id that does not exist at all", async () => {
    findFirst.mockResolvedValue(null);

    const [error] = await disableMachineService(TENANT, "00000000-0000-4000-8000-000000000000", {
      reason: "r",
      revokeCertificate: false,
    });

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
  });

  it("does not revoke any certificate when revokeCertificate is false", async () => {
    await disableMachineService(TENANT, MACHINE, { reason: "r", revokeCertificate: false });

    expect(certUpdateMany).not.toHaveBeenCalled();
  });

  it("revokes all of the machine's unrevoked certificates when revokeCertificate is true", async () => {
    await disableMachineService(TENANT, MACHINE, { reason: "fraud", revokeCertificate: true });

    expect(certUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { machineId: MACHINE, revokedAt: null },
        data: expect.objectContaining({ revokedReason: "fraud" }),
      }),
    );
  });

  it("reports kicked: false rather than failing the request when EMQX is unreachable", async () => {
    kickMqttClientMock.mockResolvedValue(false);

    const [error, result] = await disableMachineService(TENANT, MACHINE, {
      reason: "r",
      revokeCertificate: false,
    });

    expect(error).toBeNull();
    expect(result).toEqual({ machineId: MACHINE, kicked: false });
  });

  it("does not report a failed kick as success", async () => {
    kickMqttClientMock.mockResolvedValue(false);

    const [, result] = await disableMachineService(TENANT, MACHINE, {
      reason: "r",
      revokeCertificate: false,
    });

    expect(result?.kicked).not.toBe(true);
  });

  it("surfaces a failing database write as UNKNOWN_ERROR", async () => {
    machineUpdate.mockRejectedValue(new Error("db down"));

    const [error] = await disableMachineService(TENANT, MACHINE, { reason: "r", revokeCertificate: false });

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});
