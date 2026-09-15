import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches
}

/** The server has no viewport, so it renders desktop and the client corrects itself after hydration. */
export function getServerSnapshot() {
  return false
}

/**
 * Hydration-safe: React uses `getServerSnapshot` while hydrating, including
 * Suspense boundaries that stream in later, so the first client render always
 * matches the server HTML and the real value is applied in a follow-up render.
 * A plain useState + useEffect only protects the initial page hydration, not a
 * boundary that hydrates after the effect has already flipped the state.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
