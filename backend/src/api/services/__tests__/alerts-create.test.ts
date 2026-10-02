import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { securityAlert: { create } } }));

import { createAlertService } from "@/api/services/alerts.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";

function stored(site: { id: string; name: string } | null) {
  return {
    id: "a-1",
    type: "error",
    message: "Configuration update did not reach the machine: no reply",
    createdAt: new Date("2026-09-29T08:00:00.000Z"),
    occurredAt: new Date("2026-09-29T08:00:00.000Z"),
    resolvedAt: null,
    machineId: MACHINE,
    machine: { name: "VM-001", site: site && { ...site, contactPhone: null, contactEmail: null } },
  };
}

beforeEach(() => {
  create.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("createAlertService", () => {
  it("stores the alert and answers the row the alerts page and the websocket show", async () => {
    create.mockResolvedValue(stored({ id: "s-1", name: "Canteen" }));

    const [error, row] = await createAlertService({ machineId: MACHINE, type: "error", message: "boom" });

    expect(error).toBeNull();
    expect(create.mock.calls[0][0].data).toEqual({ machineId: MACHINE, type: "error", message: "boom" });
    expect(row).toMatchObject({
      id: "a-1",
      type: "error",
      machineId: MACHINE,
      machineName: "VM-001",
      siteId: "s-1",
      siteName: "Canteen",
      createdAt: "2026-09-29T08:00:00.000Z",
      resolvedAt: null,
    });
  });

  it("stores the alert but answers no row for a machine without a site", async () => {
    create.mockResolvedValue(stored(null));

    const [error, row] = await createAlertService({ machineId: MACHINE, type: "error", message: "boom" });

    expect(error).toBeNull();
    expect(row).toBeNull();
  });

  it("answers UNKNOWN_ERROR rather than throwing", async () => {
    create.mockRejectedValue(new Error("db down"));

    const [error] = await createAlertService({ machineId: MACHINE, type: "error", message: "boom" });

    expect(error?.reason).toBe("UNKNOWN_ERROR");
  });
});
