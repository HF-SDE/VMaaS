"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { EditorSlot } from "../types"
import { BOARD_GPIO_MESSAGE, isBoardGpio, isReservedGpio, MAX_OUTPUT_GPIO, RESERVED_GPIO_MESSAGE } from "@vmaas/shared/lib/gpio"

/** One WIRING_SLOT UART frame holds slot + pin_count + six pin bytes. */
const MAX_PINS = 6

interface SlotInspectorProps {
  slot: EditorSlot | null
  /** Every GPIO already used anywhere in this machine, including the selected
   *  slot's own pins; a pin drives one motor. */
  usedPins: Set<number>
  onChange: (slot: EditorSlot) => void
}

export function SlotInspector({ slot, usedPins, onChange }: SlotInspectorProps) {
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!slot) {
    return (
      <aside className="w-64 rounded-lg border p-3 text-sm text-muted-foreground">
        Select a slot to set its motor pins.
      </aside>
    )
  }

  function addPin() {
    if (!slot) return

    const number = Number(draft)

    if (draft.trim() === "" || !Number.isInteger(number)) {
      setError("Enter a GPIO number")
      return
    }
    if (number < 0 || number > MAX_OUTPUT_GPIO) {
      setError(`GPIO must be 0-${MAX_OUTPUT_GPIO}; 34-39 are input-only`)
      return
    }
    if (isReservedGpio(number)) {
      setError(RESERVED_GPIO_MESSAGE)
      return
    }
    if (isBoardGpio(number)) {
      setError(BOARD_GPIO_MESSAGE)
      return
    }
    if (slot.pins.some((pin) => pin.number === number)) {
      setError("That GPIO is already on this slot")
      return
    }
    if (usedPins.has(number)) {
      setError("That GPIO already drives another slot")
      return
    }
    if (slot.pins.length >= MAX_PINS) {
      setError(`A slot can have at most ${MAX_PINS} pins`)
      return
    }

    setError(null)
    setDraft("")
    onChange({ ...slot, pins: [...slot.pins, { number }] })
  }

  function removePin(number: number) {
    if (!slot) return
    onChange({ ...slot, pins: slot.pins.filter((pin) => pin.number !== number) })
  }

  return (
    <aside className="w-64 space-y-3 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">Slot #{slot.slotNumber}</h2>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Motor pins</p>
        {slot.pins.length === 0 && (
          <p className="text-xs text-destructive">
            Not wired. The machine cannot be published until every slot has a pin.
          </p>
        )}
        <ul className="space-y-1">
          {slot.pins.map((pin) => (
            <li key={pin.number} className="flex items-center justify-between text-sm">
              <span>GPIO {pin.number}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove GPIO ${pin.number}`}
                onClick={() => removePin(pin.number)}
              >
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addPin()
            }
          }}
          inputMode="numeric"
          placeholder="GPIO"
          aria-label="GPIO number"
        />
        <Button type="button" variant="outline" size="icon" aria-label="Add pin" onClick={addPin}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </aside>
  )
}
