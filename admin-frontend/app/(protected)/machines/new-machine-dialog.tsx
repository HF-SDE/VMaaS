"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ClaimResult } from "@/types/responses"

import { ClaimFormValues, ClaimMachineForm } from "./claim-form"
import { SetupCodePanel } from "./setup-code-panel"

/**
 * Adding a machine to this tenant, which is a claim: the machine already exists
 * in the platform, registered by serial number before it shipped, and claiming
 * binds it to this tenant and a site and answers a one-time setup code.
 *
 * The dialog has two states. The form, and then the code — which is shown once
 * and stored only as a hash, so it is never reachable again from a list.
 */
export function NewMachineDialog() {
  const [open, setOpen] = useState(false)
  const [claimed, setClaimed] = useState<{
    result: ClaimResult
    values: ClaimFormValues
  } | null>(null)

  function close() {
    setOpen(false)
    // Cleared on the way out rather than on the way in, so the code is gone the
    // moment the dialog is dismissed instead of lingering behind a reopen.
    setClaimed(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <DialogTrigger render={<Button variant="default">Create machine</Button>} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {claimed ? "Setup code" : "Create machine"}
          </DialogTitle>
          <DialogDescription>
            {claimed
              ? "The machine is now yours. Finish setting it up on the machine itself."
              : "Enter the serial number printed on the machine and choose where it stands."}
          </DialogDescription>
        </DialogHeader>

        {claimed ? (
          <SetupCodePanel
            result={claimed.result}
            claimed={claimed.values}
            onDone={close}
          />
        ) : (
          <ClaimMachineForm
            onCancel={close}
            onClaimed={(result, values) => setClaimed({ result, values })}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
