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

import { EditMachineForm } from "../form"
import { machineWriteErrorMessage } from "../messages"
import { DeleteMachineDialog } from "./delete-machine-dialog"
import { fetchData } from "@/lib/data/data-fetch"

type MachineActionsProps = {
  id: string
  name: string
  /** The site the machine stands at. Required, so the edit form always opens
   *  with a site already picked. */
  site: { id: string; name: string }
  /** False once slots or sales reference the machine; it cannot be deleted then. */
  canDelete: boolean
}

/**
 * The write actions on a machine's page.
 *
 * Takes plain values rather than the machine row: the server component that
 * renders this holds Prisma's `Date` fields, and narrowing them here keeps the
 * client boundary to what the buttons actually need.
 *
 * There is no archive action to mirror the products page — a machine has no
 * archived state, only the firmware-reported `status`, which an admin does not
 * set.
 */
export function MachineActions({
  id,
  name,
  site,
  canDelete,
}: MachineActionsProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => setEditOpen(true)}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>

      {/* A machine with slots or sales cannot be deleted at all — the button is
          left out rather than shown disabled, since there is nothing the user
          could do to make it work from here. */}
      {canDelete && (
        <DeleteMachineDialog
          name={name}
          onConfirm={async () => {
            const [error] = await fetchData<{ success: true }>(
              `/api/machines/${id}`,
              { method: "DELETE" }
            )
            if (error) {
              toast.error(machineWriteErrorMessage(error.status))
              return
            }
            toast.success(`"${name}" deleted.`)
            setDeleteOpen(false)
            router.push("/machines")
          }}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit machine</DialogTitle>
            <DialogDescription>
              Change the name or move the machine to another site, and save to
              update it.
            </DialogDescription>
          </DialogHeader>
          {/* The picker needs the site's name to show and the form needs its id
              to send, hence the two props. */}
          <EditMachineForm
            id={id}
            defaultValues={{ name, siteId: site.id }}
            defaultSiteName={site.name}
            onSaved={() => setEditOpen(false)}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
