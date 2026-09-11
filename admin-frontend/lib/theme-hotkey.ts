const THEME_HOTKEY = "d"

/**
 * Window keydown listeners receive whatever any script on the page dispatches,
 * including plain `Event("keydown")` objects with no `key`. Validate the shape
 * before reading it.
 */
function matchesThemeHotkey(key: unknown) {
  return typeof key === "string" && key.toLowerCase() === THEME_HOTKEY
}

export { THEME_HOTKEY, matchesThemeHotkey }
