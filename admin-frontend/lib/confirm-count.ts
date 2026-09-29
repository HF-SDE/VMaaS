import { toast } from "sonner"

import { fetchData } from "@/lib/data/data-fetch"
import { trackPriceSync } from "@/lib/price-sync"
import type { PricePublishOutcome } from "@vmaas/shared/types/configuration"

/**
 * "Confirm count": the slot was counted and its quantity is already right.
 * The backend records the count and publishes, so the machine and late sales
 * know from when the quantity is a counted number (spec: slot stock). Shows
 * the result and hands `publish` to the sync toasts.
 *
 * @param errorMessage Turns an HTTP status into what the user reads; the slot
 *        form passes its own wording.
 * @return True when the count was recorded.
 */
export async function confirmSlotCount(
  slotId: string,
  errorMessage: (status: number) => string = () =>
    "The count could not be confirmed. Try again."
): Promise<boolean> {
  const [error, saved] = await fetchData<{ publish?: PricePublishOutcome[] }>(
    `/api/slots/${slotId}/confirm-count`,
    { method: "POST" }
  )

  if (error) {
    toast.error(errorMessage(error.status))
    return false
  }

  toast.success("Count confirmed.")
  trackPriceSync(saved.publish)
  return true
}
