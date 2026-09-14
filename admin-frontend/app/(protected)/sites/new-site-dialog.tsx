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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Site</DialogTitle>
          <DialogDescription>
            Fill out the form to create a new site. Only the name is required —
            the address and contact details can be added later.
          </DialogDescription>
        </DialogHeader>
        <CreateSiteForm triggerCloseDialog={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
