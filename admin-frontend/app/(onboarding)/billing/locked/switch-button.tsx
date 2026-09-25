"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { switchTenant } from "@/app/(protected)/actions"

/**
 * Clears the active organization and sends the user to the picker.
 *
 * Without this the locked page is a dead end for a user who belongs to a
 * healthy organization as well — the access resolver would keep routing them
 * back here on the strength of the active one.
 */
export function SwitchOrganizationButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function switchAway() {
    startTransition(async () => {
      const [error] = await switchTenant(null)
      if (error) {
        toast.error("Could not switch organization. Please try again.")
        return
      }
      router.push("/organizations/select")
    })
  }

  return (
    <Button variant="outline" onClick={switchAway} disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      Switch organization
    </Button>
  )
}
