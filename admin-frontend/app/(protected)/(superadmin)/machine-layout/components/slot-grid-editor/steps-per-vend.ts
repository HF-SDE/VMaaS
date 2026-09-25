import { STEPS_PER_VEND_MAX, STEPS_PER_VEND_MIN } from "@vmaas/shared/lib/gpio"

/** Why a string is rejected as a step count, or null when it is usable. The card shows the text. */
export function stepsPerVendError(raw: string): string | null {
  const trimmed = raw.trim()
  const value = Number(trimmed)
  if (trimmed === "" || !Number.isInteger(value)) return "Enter the number of steps"
  if (value < STEPS_PER_VEND_MIN || value > STEPS_PER_VEND_MAX) {
    return `Steps must be ${STEPS_PER_VEND_MIN}-${STEPS_PER_VEND_MAX}`
  }
  return null
}
