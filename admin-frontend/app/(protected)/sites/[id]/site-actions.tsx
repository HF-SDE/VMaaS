"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EditSiteForm, type SiteFormValues } from "../form"
import { siteWriteErrorMessage } from "../messages"
import { DeleteSiteDialog } from "./delete-site-dialog"
import { fetchData } from "@/lib/data/data-fetch"

type SiteActionsProps = {
  id: string
  name: string
  /** The site's text columns with null flattened to "", plus its coordinates
   *  as numbers — the edit stepper seeds both its fields and its map from it. */
  defaultValues: SiteFormValues
  /** False while machines still stand at the site. */
  canDelete: boolean
}

/**
 * The write actions on a site's page.
 *
 * Takes plain values rather than the site row: the server component that
 * renders this holds Prisma's `Decimal` and `Date` fields, and narrowing them
 * there keeps the client boundary to what the buttons actually need.
 *
 * There is no archive button as products have — `Site` carries no `archivedAt`.
 */
export function SiteActions({
  id,
  name,
  defaultValues,
  canDelete,
}: SiteActionsProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => setEditOpen(true)}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>

      {/* A site with machines cannot be deleted at all — the button is left out
          rather than shown disabled, and the card states the machine count. */}
      {canDelete && (
        <DeleteSiteDialog
          name={name}
          onConfirm={async () => {
            const [error] = await fetchData<null>(`/api/sites/${id}`, {
              method: "DELETE",
            })
            if (error) {
              toast.error(siteWriteErrorMessage(error.status))
              return
            }
            toast.success(`"${name}" deleted.`)
            setDeleteOpen(false)
            router.push("/sites")
          }}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        {/* Wider than the delete dialog: the stepper carries a four-tab strip,
            a three-column address row and a map. */}
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Site</DialogTitle>
            <DialogDescription>
              Step through the site&apos;s details and save to update it.
            </DialogDescription>
          </DialogHeader>
          {/* Remounted per opening: the stepper starts on step one and seeds
              TanStack Form from `defaultValues`, so a dialog kept mounted would
              still show the previous edit's values after a save. */}
          {editOpen && (
            <EditSiteForm
              id={id}
              defaultValues={defaultValues}
              onSaved={() => setEditOpen(false)}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
