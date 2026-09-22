import { describe, expect, it } from "vitest"

import { claimErrorMessage, formatSetupCode, timeLeftLabel } from "../claim"

describe("claimErrorMessage", () => {
  it("names the serial number for a 404", () => {
    // The backend answers 404 for an unknown serial AND for a site that does
    // not belong to the tenant, and HttpError carries no body — so the wording
    // has to admit both rather than assert the likelier one.
    expect(claimErrorMessage(404)).toBe(
      "No machine has that serial number, or the site no longer exists."
    )
  })

  it("explains a 409 as an already claimed machine", () => {
    expect(claimErrorMessage(409)).toBe(
      "That machine is already claimed. It has to be released before it can be claimed again."
    )
  })

  it("matches the section's wording for the shared statuses", () => {
    expect(claimErrorMessage(401)).toBe("Your session has expired. Sign in again.")
    expect(claimErrorMessage(403)).toBe("You do not have permission to change machines.")
    expect(claimErrorMessage(400)).toBe("Check the fields and try again.")
    expect(claimErrorMessage(500)).toBe("An unexpected error occurred. Please try again.")
  })

  it("words any 5xx as the generic failure", () => {
    // nginx sits in front of the backend and answers 502/503/504 of its own,
    // and the caller cannot filter those out: clientFetch puts
    // response.statusText in `reason`, which is "Bad Gateway" rather than a
    // symbol, and empty over HTTP/2. Throwing here would turn a gateway blip
    // into an unhandled rejection in the dialog.
    expect(claimErrorMessage(502)).toBe("An unexpected error occurred. Please try again.")
    expect(claimErrorMessage(503)).toBe("An unexpected error occurred. Please try again.")
    expect(claimErrorMessage(504)).toBe("An unexpected error occurred. Please try again.")
  })

  it("throws on a status the endpoint cannot answer", () => {
    // Same contract as machineWriteErrorMessage: an unhandled status is a bug
    // to surface, not a string to invent.
    expect(() => claimErrorMessage(418)).toThrow()
  })
})

describe("formatSetupCode", () => {
  it("splits the eight digits into two groups of four", () => {
    // Read aloud off a screen and typed one digit at a time on a keypad;
    // grouping is what stops someone losing their place.
    expect(formatSetupCode("48273905")).toBe("4827 3905")
  })

  it("leaves a short last group alone rather than padding it", () => {
    expect(formatSetupCode("482739")).toBe("4827 39")
  })

  it("survives an empty code", () => {
    expect(formatSetupCode("")).toBe("")
  })
})

describe("timeLeftLabel", () => {
  const now = new Date("2026-09-21T12:00:00Z")

  it("counts down in minutes and seconds", () => {
    expect(timeLeftLabel("2026-09-21T12:59:47Z", now)).toBe("59:47")
  })

  it("pads the seconds", () => {
    expect(timeLeftLabel("2026-09-21T12:01:05Z", now)).toBe("1:05")
  })

  it("says so once the code is past its expiry", () => {
    expect(timeLeftLabel("2026-09-21T11:59:59Z", now)).toBe("Expired")
  })

  it("treats the exact expiry moment as expired", () => {
    expect(timeLeftLabel("2026-09-21T12:00:00Z", now)).toBe("Expired")
  })
})
