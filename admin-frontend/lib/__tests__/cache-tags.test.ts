import { describe, expect, it } from "vitest"
import { tenantTags } from "@/lib/cache-tags"

describe("tenantTags", () => {
  it("lists every cached resource for a tenant", () => {
    expect(tenantTags("t1")).toEqual(["machines:t1", "members:t1"])
  })

  it("keys tags per tenant so one switch cannot clear another's cache", () => {
    expect(tenantTags("t1")).not.toEqual(tenantTags("t2"))
  })
})
