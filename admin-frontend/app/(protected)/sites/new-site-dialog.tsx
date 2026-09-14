"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CreateSiteForm } from "./form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function NewSiteDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="default">Create Site</Button>} />
      {/* Wider than the other dialogs: the stepper carries a four-tab strip, a
          three-column address row and a map. */}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Site</DialogTitle>
          <DialogDescription>
            Start with the site&apos;s name — contact details and the address are
            optional and can be added later.
          </DialogDescription>
        </DialogHeader>
        <CreateSiteForm triggerCloseDialog={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
