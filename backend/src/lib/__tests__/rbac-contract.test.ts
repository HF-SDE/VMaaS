import { PERMISSIONS } from "@/lib/rbac";

import { PERMISSIONS as SHARED } from "@vmaas/shared/types";
import { describe, expect, it } from "vitest";

describe("permission contract", () => {
  it("re-exports the shared object identically", () => {
    expect(PERMISSIONS).toBe(SHARED);
  });

  it("still exposes every key the routes reference", () => {
    expect(PERMISSIONS.MACHINE_READ).toBe("machine:read");
    expect(PERMISSIONS.USER_MANAGE).toBe("user:manage");
    expect(PERMISSIONS.TENANT_MANAGE).toBe("tenant:manage");
  });
});
