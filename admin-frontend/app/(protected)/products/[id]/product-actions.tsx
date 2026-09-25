"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Archive, ArchiveRestore, Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EditProductForm } from "../form"
import { productWriteErrorMessage } from "../messages"
import { DeleteProductDialog } from "./delete-product-dialog"
import { fetchData } from "@/lib/data/data-fetch"
import type { ProductDetail } from "@backend-responses"

type ProductActionsProps = {
  id: string
  name: string
  price: number
  archived: boolean
  /** How many machine slots stock the product. Above zero, it cannot be deleted. */
  canDelete: boolean
}

/**
 * The write actions on a product's page.
 *
 * Takes plain values rather than the product row: the server component that
 * renders this holds Prisma's `Decimal` and `Date` fields, and narrowing them
 * here keeps the client boundary to what the buttons actually need.
 */
export function ProductActions({
  id,
  name,
  price,
  archived,
  canDelete,
}: ProductActionsProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [isArchiving, startArchiving] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)

  function toggleArchived() {
    startArchiving(async () => {
      const path = `/api/products/${id}/${archived ? "unarchive" : "archive"}`

      const [error, product] = await fetchData<ProductDetail>(path, {
        method: "POST",
      })

      if (error) {
        toast.error(productWriteErrorMessage(error.status))
        return
      }

      toast.success(archived ? "Product restored." : "Product archived.")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => setEditOpen(true)}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>

      <Button variant="outline" onClick={toggleArchived} disabled={isArchiving}>
        {isArchiving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : archived ? (
          <ArchiveRestore className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
        {archived ? "Restore" : "Archive"}
      </Button>

      {/* A product stocked by a slot cannot be deleted at all — the button is
          left out rather than shown disabled, and the card states the usage. */}
      {canDelete && (
        <DeleteProductDialog
          name={name}
          onConfirm={async () => {
            const [error] = await fetchData<null>(`/api/products/${id}`, {
              method: "DELETE",
            })
            if (error) {
              toast.error(productWriteErrorMessage(error.status))
            }
            toast.success(`"${name}" deleted.`)
            setDeleteOpen(false)
            router.push("/products")
          }}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>
              Change the name or price, and save to update the product.
            </DialogDescription>
          </DialogHeader>
          <EditProductForm
            id={id}
            defaultValues={{ name, price }}
            onSaved={() => setEditOpen(false)}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
