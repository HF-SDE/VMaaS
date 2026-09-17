"use client"

import { useState, type KeyboardEvent } from "react"
import { toast } from "sonner"

import { AxisLabels } from "./components/axis-labels"
import { EditorToolbar } from "./components/editor-toolbar"
import { SizeControl } from "./components/size-control"
import { SlotGrid } from "./components/slot-grid"
import { GAP } from "./constants"
import { useLayoutHistory } from "./hooks/use-layout-history"
import { useSlotDragging } from "./hooks/use-slot-dragging"
import { useUnsavedChangesWarning } from "./hooks/use-unsaved-changes-warning"
import { canRemoveColumn, canRemoveRow } from "./layout-math"
import { createSavePayload } from "./save-payload"
import type { EditorSlot } from "./types"
import { fetchData } from "@/lib/data/data-fetch"
import { findFloatingSlots } from "@vmaas/shared/lib/slot-layout"

import { saveLayoutErrorMessage } from "../../messages"

interface SlotGridEditorProps {
  machineId: string
  initialSlots: EditorSlot[]
}

export function SlotGridEditor({
  machineId,
  initialSlots,
}: SlotGridEditorProps) {
  const history = useLayoutHistory(initialSlots)
  const { layout } = history
  const { slots, columns, rows } = layout

  const [selection, setSelection] = useState<string | null>(null)
  // Undo can remove the selected slot, so the selection only counts while the slot exists
  const selectedSlot = slots.find((slot) => slot.key === selection) ?? null
  const selectedKey = selectedSlot?.key ?? null

  // Only point out floating slots after a save was denied, not while the user is still building.
  // Recalculated on every render, so the outlines disappear as the slots get fixed.
  const [showSaveErrors, setShowSaveErrors] = useState(false)
  const floatingSlots = findFloatingSlots(slots)
  const invalidSlotKeys = new Set(
    showSaveErrors ? floatingSlots.map((slot) => slot.key) : []
  )

  const dragging = useSlotDragging({
    layout,
    onChange: history.update,
    onSelect: setSelection,
  })

  useUnsavedChangesWarning(history.isDirty)

  function deleteSelected() {
    if (!selectedKey) return
    history.update({ slots: slots.filter((slot) => slot.key !== selectedKey) })
    setSelection(null)
  }

  function reset() {
    history.reset()
    setSelection(null)
  }

  async function save() {
    if (!history.isDirty) return

    if (floatingSlots.length > 0) {
      setShowSaveErrors(true)
      const slotNumbers = floatingSlots.map((slot) => `#${slot.slotNumber}`)
      toast.error("The layout can't be saved", {
        description: `These slots have empty space below them: ${slotNumbers.join(", ")}`,
      })
      return
    }
    setShowSaveErrors(false)

    const payload = createSavePayload(machineId, layout)

    const [error] = await fetchData("/api/machines/save-slot-layout", {
      method: "POST",
      // Not JSON.stringify'd here: fetchData encodes the body itself
      body: payload,
    })

    if (error) {
      toast.error("The layout could not be saved", {
        description: saveLayoutErrorMessage(error.status),
      })
      return
    }

    history.markSaved()
    toast.success("The layout was saved")
  }

  /** Delete/Escape, while the grid has focus */
  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      deleteSelected()
    } else if (event.key === "Escape") {
      dragging.cancel()
      setSelection(null)
    }
  }

  /**
   * Save and undo/redo, anywhere inside the editor (so they also work right after pressing a button).
   * Not on window, since the page can show several editors.
   */
  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (dragging.interaction) return
    if (event.target instanceof HTMLInputElement) return
    if (event.target instanceof HTMLTextAreaElement) return
    if (!(event.ctrlKey || event.metaKey)) return

    const key = event.key.toLowerCase()
    if (key === "s") {
      // Also stops the browser's own "Save page" dialog
      event.preventDefault()
      save()
    } else if (key === "z" && !event.shiftKey) {
      event.preventDefault()
      history.undo()
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault()
      history.redo()
    }
  }

  // Emphasise the axis numbers of the slot being dragged, or else the selected slot
  const highlightedRect = dragging.preview?.rect ?? selectedSlot

  return (
    <div className="my-3 space-y-3" onKeyDown={handleEditorKeyDown}>
      <EditorToolbar
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        canDelete={selectedKey !== null}
        canReset={history.isDirty}
        canSave={history.isDirty}
        onUndo={history.undo}
        onRedo={history.redo}
        onDelete={deleteSelected}
        onReset={reset}
        onSave={save}
      />

      <p className="text-sm text-muted-foreground">
        Drag across empty cells to create a slot. Drag a slot to move it, or
        drag any of its sides to stretch it. Select a slot and press Delete to
        remove it.
      </p>

      <div className="max-w-full overflow-x-auto p-1">
        {/*
          3x3 layout:
                    [row controls]
          [y axis]  [grid]          [column controls]
                    [x axis]
        */}
        <div
          className="grid w-max"
          style={{ gridTemplateColumns: "auto auto auto", gap: GAP }}
        >
          {/* Top row */}
          <div />
          <SizeControl
            orientation="horizontal"
            label="row"
            showDecrease={rows > 1}
            canDecrease={canRemoveRow(layout)}
            onDecrease={() => history.update({ rows: rows - 1 })}
            onIncrease={() => history.update({ rows: rows + 1 })}
          />
          <div />

          {/* Middle row */}
          <AxisLabels
            orientation="vertical"
            count={rows}
            highlighted={
              highlightedRect && [highlightedRect.beginY, highlightedRect.endY]
            }
          />
          <SlotGrid
            layout={layout}
            selectedKey={selectedKey}
            invalidSlotKeys={invalidSlotKeys}
            interaction={dragging.interaction}
            preview={dragging.preview}
            pointerHandlers={dragging.pointerHandlers}
            onKeyDown={handleGridKeyDown}
          />
          <SizeControl
            orientation="vertical"
            label="column"
            showDecrease={columns > 1}
            canDecrease={canRemoveColumn(layout)}
            onDecrease={() => history.update({ columns: columns - 1 })}
            onIncrease={() => history.update({ columns: columns + 1 })}
          />

          {/* Bottom row */}
          <div />
          <AxisLabels
            orientation="horizontal"
            count={columns}
            highlighted={
              highlightedRect && [highlightedRect.beginX, highlightedRect.endX]
            }
          />
          <div />
        </div>
      </div>
    </div>
  )
}
