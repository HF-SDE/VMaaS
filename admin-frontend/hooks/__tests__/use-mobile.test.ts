import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { getServerSnapshot, useIsMobile } from "@/hooks/use-mobile"

function Probe() {
  return createElement("span", null, useIsMobile() ? "mobile" : "desktop")
}

describe("useIsMobile", () => {
  it("renders the desktop branch on the server, where there is no viewport", () => {
    expect(renderToString(createElement(Probe))).toBe("<span>desktop</span>")
  })

  it("tells React to hydrate with the desktop value so the first client render matches the server", () => {
    expect(getServerSnapshot()).toBe(false)
  })
})
