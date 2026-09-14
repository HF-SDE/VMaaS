"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { DeleteProductError } from "@/lib/data/products"
import type { Result } from "@vmaas/shared/lib/error-handling"

import { productWriteErrorMessage } from "../messages"

/**
 * Confirms deleting a product, then sends the user back to the list.
 *
 * The redirect lives here rather than in the server action: redirecting from
 * the action would throw through the `await` below, leaving the dialog unable
 * to report a failure or close itself.
 */
export function DeleteProductDialog({
  name,
  onConfirm,
}: {
  name: string
  onConfirm: () => Promise<Result<DeleteProductError, null>>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isDeleting, startDeleting] = useTransition()

  function confirm() {
    startDeleting(async () => {
      const [error] = await onConfirm()

      if (error) {
        // CONFLICT means a slot started stocking the product after the page
        // was rendered — the button is hidden for a product already in use.
        toast.error(productWriteErrorMessage(error, "delete"))
        setOpen(false)
        router.refresh()
        return
      }

      toast.success(`"${name}" deleted.`)
      setOpen(false)
      router.push("/products")
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" className="text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The product will be permanently deleted. If you want to be able to
            find it again later, archive it instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={confirm}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete product
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
