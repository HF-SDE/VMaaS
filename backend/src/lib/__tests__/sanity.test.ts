import { describe, expect, it } from "vitest"
import { PERMISSIONS } from "@/lib/rbac"

describe("test harness", () => {
  it("resolves the @/ path alias", () => {
    expect(PERMISSIONS.MACHINE_READ).toBe("machine:read")
  })
})
