import { describe, expect, it } from "vitest"
import { parseConfig } from "../config"

describe("parseConfig", () => {
  it("falls back to the public backend URL for server-side calls", () => {
    const config = parseConfig({ NEXT_PUBLIC_BACKEND_URL: "http://localhost" })

    expect(config.BACKEND_INTERNAL_URL).toBe("http://localhost")
  })

  it("prefers an explicit internal URL for server-side calls", () => {
    const config = parseConfig({
      NEXT_PUBLIC_BACKEND_URL: "http://localhost",
      BACKEND_INTERNAL_URL: "http://backend:5000",
    })

    expect(config.NEXT_PUBLIC_BACKEND_URL).toBe("http://localhost")
    expect(config.BACKEND_INTERNAL_URL).toBe("http://backend:5000")
  })

  it("rejects an internal URL that is not a URL", () => {
    expect(() =>
      parseConfig({ BACKEND_INTERNAL_URL: "backend:5000" })
    ).toThrow()
  })
})
