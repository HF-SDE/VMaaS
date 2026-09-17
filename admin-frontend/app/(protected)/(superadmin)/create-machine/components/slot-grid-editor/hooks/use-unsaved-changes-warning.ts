import { useEffect } from "react"

const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes to the slot layout. Are you sure you want to leave?"

// Shared across all editors on the page, so leaving only asks once even if several have changes
let dirtyEditorCount = 0

/**
 * Warns before leaving the page while `isDirty` is true.
 *
 * Covers closing/reloading the tab and clicking links. Not covered: the browser's
 * back/forward buttons and navigation in code (router.push).
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return

    dirtyEditorCount++
    if (dirtyEditorCount === 1) {
      window.addEventListener("beforeunload", handleBeforeUnload)
      document.addEventListener("click", handleLinkClick, true)
    }

    return () => {
      dirtyEditorCount--
      if (dirtyEditorCount === 0) {
        window.removeEventListener("beforeunload", handleBeforeUnload)
        document.removeEventListener("click", handleLinkClick, true)
      }
    }
  }, [isDirty])
}

/** Closing or reloading the tab. Browsers show their own message; the text can't be customised. */
function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ""
}

/**
 * Next.js client-side navigation doesn't fire beforeunload, so link clicks are intercepted instead.
 * Registered in the capture phase, so it runs before Next's <Link> handler, which skips prevented events.
 */
function handleLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return
  // Modified clicks open a new tab/window, which doesn't leave this page
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  const link = (event.target as Element | null)?.closest("a[href]")
  if (!(link instanceof HTMLAnchorElement)) return
  if (link.target === "_blank" || link.hasAttribute("download")) return

  const url = new URL(link.href)
  // Links to other sites do a full page load, which beforeunload already covers
  if (url.origin !== window.location.origin) return

  const isSamePage =
    url.pathname === window.location.pathname &&
    url.search === window.location.search
  if (isSamePage) return

  if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
    event.preventDefault()
    event.stopPropagation()
  }
}
