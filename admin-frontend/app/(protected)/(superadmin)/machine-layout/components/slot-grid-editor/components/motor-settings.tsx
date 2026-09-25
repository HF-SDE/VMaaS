"use client"

import { useState } from "react"

import { Input } from "@/components/ui/input"

import { stepsPerVendError } from "../steps-per-vend"

interface MotorSettingsProps {
  stepsPerVend: number
  /** Called with a valid value on blur or Enter, so typing does not create one undo step per digit. */
  onChange: (stepsPerVend: number) => void
}

/**
 * The machine-level motor setting. One value for every slot: the motors are
 * steppers on one shared STEP line, and a vend is a fixed number of pulses.
 * The pulse interval is a firmware constant, so no duration can be shown here.
 */
export function MotorSettings({ stepsPerVend, onChange }: MotorSettingsProps) {
  const [draft, setDraft] = useState(String(stepsPerVend))
  const [error, setError] = useState<string | null>(null)

  // Undo/redo/reset change the prop underneath an untouched field; follow them.
  const [seen, setSeen] = useState(stepsPerVend)
  if (seen !== stepsPerVend) {
    setSeen(stepsPerVend)
    setDraft(String(stepsPerVend))
    setError(null)
  }

  function commit() {
    const problem = stepsPerVendError(draft)
    setError(problem)
    if (problem) return
    const value = Number(draft.trim())
    if (value !== stepsPerVend) onChange(value)
  }

  return (
    <aside className="w-64 space-y-2 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">Motor</h2>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>Steps per vend</span>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          inputMode="numeric"
          aria-label="Steps per vend"
          aria-invalid={error !== null}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        6400 = one full turn at 1/32 microstepping. Applies to every slot.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </aside>
  )
}
