import { useState } from "react"

import { MAX_HISTORY } from "../constants"
import { layoutFromSlots } from "../layout-math"
import type { EditorSlot, Layout } from "../types"

interface History {
  past: Layout[]
  present: Layout
  future: Layout[]
}

/**
 * Holds the current layout, plus the steps before and after it for undo/redo.
 * Every change goes through `update`, which makes it a new undoable step.
 */
export function useLayoutHistory(initialSlots: EditorSlot[]) {
  // The last saved layout (at first, the loaded one). Kept in state so its identity is
  // stable, since isDirty compares against it.
  const [savedLayout, setSavedLayout] = useState(() =>
    layoutFromSlots(initialSlots)
  )
  const [history, setHistory] = useState<History>({
    past: [],
    present: savedLayout,
    future: [],
  })

  function push(layout: Layout) {
    setHistory((current) => ({
      past: [...current.past, current.present].slice(-MAX_HISTORY),
      present: layout,
      future: [],
    }))
  }

  /** Change part of the layout as a new undoable step */
  function update(changes: Partial<Layout>) {
    push({ ...history.present, ...changes })
  }

  function undo() {
    setHistory((current) => {
      if (current.past.length === 0) return current
      return {
        past: current.past.slice(0, -1),
        present: current.past[current.past.length - 1],
        future: [current.present, ...current.future],
      }
    })
  }

  function redo() {
    setHistory((current) => {
      if (current.future.length === 0) return current
      return {
        past: [...current.past, current.present],
        present: current.future[0],
        future: current.future.slice(1),
      }
    })
  }

  /** Go back to the last saved layout. It's a step of its own, so it can be undone too. */
  function reset() {
    // Pushing savedLayout itself (not a copy) makes isDirty false again
    push(savedLayout)
  }

  /** Mark the current layout as saved, so it no longer counts as unsaved changes */
  function markSaved() {
    setSavedLayout(history.present)
  }

  return {
    layout: history.present,
    update,
    undo,
    redo,
    reset,
    markSaved,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    isDirty: history.present !== savedLayout,
  }
}
