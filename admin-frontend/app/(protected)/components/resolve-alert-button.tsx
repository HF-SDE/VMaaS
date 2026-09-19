"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { resolveAlert } from "../actions"
import { useRowResolve } from "./alert-row"

export function ResolveAlertButton({ alertId }: { alertId: string }) {
  const [pending, startTransition] = useTransition()
  // null when the button is used outside an <AlertRow> — then it just doesn't
  // animate, which is the old behaviour.
  const row = useRowResolve()

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        // Outside the transition, so the row starts collapsing on this click
        // rather than waiting for the action and the refresh it triggers.
        row?.collapse()

        startTransition(async () => {
          const [error] = await resolveAlert(alertId)
          // 409 is the expected race: two operators working the same queue.
          // The alert is gone either way, so the row stays collapsed.
          if (error) {
            if (error.status !== 409) row?.restore()
            toast.error(
              error.status === 409
                ? "Someone already resolved that alert."
                : "Couldn't resolve the alert."
            )
            return
          }
          toast.success("Alert resolved.")
        })
      }}
    >
      {pending ? "Resolving…" : "Resolve"}
    </Button>
  )
}
