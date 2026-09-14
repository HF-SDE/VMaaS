"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CreateProductForm } from "./form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function NewProductDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="default">Create Product</Button>}
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Product</DialogTitle>
          <DialogDescription>
            Fill out the form to create a new product. Click save when you are
            done.
          </DialogDescription>
        </DialogHeader>
        <CreateProductForm triggerCloseDialog={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
