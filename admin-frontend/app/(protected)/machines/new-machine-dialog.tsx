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
import { CreateMachineForm } from "./form"

export function NewMachineDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="default">Create machine</Button>}
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create machine</DialogTitle>
          <DialogDescription>
            Fill out the form to create a new machine. Click save when you are
            done.
          </DialogDescription>
        </DialogHeader>
        <CreateMachineForm triggerCloseDialog={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
