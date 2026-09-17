import { Redo2, RotateCcw, Save, Trash2, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface EditorToolbarProps {
  canUndo: boolean
  canRedo: boolean
  canDelete: boolean
  canReset: boolean
  canSave: boolean
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onReset: () => void
  onSave: () => void
}

export function EditorToolbar({
  canUndo,
  canRedo,
  canDelete,
  canReset,
  canSave,
  onUndo,
  onRedo,
  onDelete,
  onReset,
  onSave,
}: EditorToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 /> Undo
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 /> Redo
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onDelete}
        disabled={!canDelete}
      >
        <Trash2 /> Delete slot
      </Button>
      <Button variant="ghost" size="sm" onClick={onReset} disabled={!canReset}>
        <RotateCcw /> Reset
      </Button>
      <Button
        size="sm"
        className="ml-auto"
        onClick={onSave}
        disabled={!canSave}
        title="Save (Ctrl+S)"
      >
        <Save /> Save
      </Button>
    </div>
  )
}
