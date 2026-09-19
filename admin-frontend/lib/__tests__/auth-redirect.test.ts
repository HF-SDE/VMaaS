import { describe, expect, it } from "vitest"
import { safeRedirectTarget, signInPath } from "@/lib/auth-redirect"

describe("safeRedirectTarget", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirectTarget("/invite/abc")).toBe("/invite/abc")
  })

  it("keeps a path with a query string", () => {
    expect(safeRedirectTarget("/machines?page=2")).toBe("/machines?page=2")
  })

  it.each([undefined, null, ""])("falls back for %s", (value) => {
    expect(safeRedirectTarget(value)).toBe("/")
  })

  // The value comes from a link someone else may have written. Echoing it into
  // router.push() unchecked would turn the sign-in page into an open redirect.
  it.each([
    "https://evil.example",
    "http://evil.example/path",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
  ])("refuses %s", (value) => {
    expect(safeRedirectTarget(value)).toBe("/")
  })
})

describe("signInPath", () => {
  it("carries the target through as a query parameter", () => {
    expect(signInPath("/invite/abc")).toBe("/login?redirect=%2Finvite%2Fabc")
  })

  it("omits the parameter when the target is the default", () => {
    expect(signInPath("/")).toBe("/login")
  })

  it("drops an unsafe target rather than passing it on", () => {
    expect(signInPath("https://evil.example")).toBe("/login")
  })

  it("can point at sign-up instead", () => {
    expect(signInPath("/invite/abc", "/sign-up")).toBe(
      "/sign-up?redirect=%2Finvite%2Fabc"
    )
  })
})
