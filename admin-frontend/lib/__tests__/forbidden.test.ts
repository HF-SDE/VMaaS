import { describe, expect, it } from "vitest"
import {
  FORBIDDEN_REASON_MAX_LENGTH,
  forbiddenPath,
  readForbiddenReason,
} from "@/lib/forbidden"

describe("forbiddenPath", () => {
  it("omits the query string when no reason is given", () => {
    expect(forbiddenPath()).toBe("/forbidden")
  })

  it("omits the query string for a blank reason", () => {
    expect(forbiddenPath("   ")).toBe("/forbidden")
  })

  it("encodes the reason, including Danish letters and spaces", () => {
    expect(forbiddenPath("Du har ikke adgang til produkter.")).toBe(
      "/forbidden?reason=Du+har+ikke+adgang+til+produkter."
    )
    expect(forbiddenPath("Adgang nægtet")).toBe(
      "/forbidden?reason=Adgang+n%C3%A6gtet"
    )
  })

  it("encodes characters that would otherwise break out of the param", () => {
    expect(forbiddenPath("a&b=c#d")).toBe("/forbidden?reason=a%26b%3Dc%23d")
  })

  it("truncates an over-long reason", () => {
    const path = forbiddenPath("x".repeat(FORBIDDEN_REASON_MAX_LENGTH + 50))
    expect(path).toBe(
      `/forbidden?reason=${"x".repeat(FORBIDDEN_REASON_MAX_LENGTH)}`
    )
  })
})

describe("readForbiddenReason", () => {
  it("falls back when the param is missing", () => {
    expect(readForbiddenReason(undefined)).toBe(
      "Du har ikke adgang til denne side."
    )
  })

  it("falls back when the param is blank", () => {
    expect(readForbiddenReason("   ")).toBe("Du har ikke adgang til denne side.")
  })

  it("returns a supplied reason, trimmed", () => {
    expect(readForbiddenReason("  Du mangler adgang.  ")).toBe(
      "Du mangler adgang."
    )
  })

  /** The param is attacker-controllable, so the page must never render an
   *  unbounded wall of text a crafted link handed it. */
  it("truncates an over-long reason", () => {
    expect(
      readForbiddenReason("y".repeat(FORBIDDEN_REASON_MAX_LENGTH + 50))
    ).toBe("y".repeat(FORBIDDEN_REASON_MAX_LENGTH))
  })

  /** Next gives repeated query params as an array; take the first. */
  it("takes the first value when the param repeats", () => {
    expect(readForbiddenReason(["Første grund", "Anden grund"])).toBe(
      "Første grund"
    )
  })

  it("falls back for an empty array", () => {
    expect(readForbiddenReason([])).toBe("Du har ikke adgang til denne side.")
  })
})
