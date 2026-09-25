"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Pencil, Trash2 } from "lucide-react"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fetchData } from "@/lib/data/data-fetch"
import { TenantRole } from "../users/page"
import { roleWriteErrorMessage } from "./messages"
import { RoleForm } from "./role-form"

export function RoleCard({
  role,
  canManage,
}: {
  role: TenantRole
  canManage: boolean
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [isDeleting, startDeleting] = useTransition()

  const cantDelete = role.name === "owner"

  async function handleDelete() {
    if (cantDelete) {
      toast.error("The owner role cannot be deleted.")
      return
    }

    const [error] = await fetchData(`/api/tenants/roles/${role.id}`, {
      method: "DELETE",
    })

    if (error) {
      toast.error(roleWriteErrorMessage(error.status))
      return
    }

    toast.success("Role deleted.")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="capitalize">{role.name}</span>
          {canManage && role.name !== "owner" && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <AlertDialog>
                {!cantDelete && (
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                  />
                )}
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This role will be permanently deleted. Roles still
                      assigned to members cannot be deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => startDeleting(handleDelete)}
                      disabled={isDeleting || cantDelete}
                    >
                      {isDeleting && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Delete role
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {role.permissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No permissions</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {role.permissions.map((permission) => (
              <Badge key={permission} variant="secondary">
                {permission}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {role.name}</DialogTitle>
            <DialogDescription>
              Rename the role or change the permissions it grants.
            </DialogDescription>
          </DialogHeader>
          <RoleForm
            defaultValues={{ name: role.name, permissions: role.permissions }}
            submitLabel="Save changes"
            onCancel={() => setEditOpen(false)}
            onSubmit={async (values) => {
              const [error] = await fetchData(`/api/tenants/roles/${role.id}`, {
                method: "PATCH",
                body: values,
              })

              if (error) return roleWriteErrorMessage(error.status)

              toast.success("Role saved.")
              setEditOpen(false)
              router.refresh()
              return null
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  )
}
