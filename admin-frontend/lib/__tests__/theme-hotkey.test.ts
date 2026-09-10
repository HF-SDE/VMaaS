import { describe, expect, it } from "vitest"
import { matchesThemeHotkey } from "@/lib/theme-hotkey"

describe("matchesThemeHotkey", () => {
  it("matches the hotkey", () => {
    expect(matchesThemeHotkey("d")).toBe(true)
  })

  it("matches the hotkey regardless of case", () => {
    expect(matchesThemeHotkey("D")).toBe(true)
  })

  it("does not match another key", () => {
    expect(matchesThemeHotkey("k")).toBe(false)
  })

  // Any script on the page can dispatch a plain Event("keydown") at window --
  // browser extensions and password managers do. Those carry no `key` at all.
  it("does not match an event that carries no key", () => {
    expect(matchesThemeHotkey(undefined)).toBe(false)
    expect(matchesThemeHotkey(null)).toBe(false)
  })
})
