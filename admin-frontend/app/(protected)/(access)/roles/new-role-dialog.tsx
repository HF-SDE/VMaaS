"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { fetchData } from "@/lib/data/data-fetch"
import { TenantRole } from "../users/page"
import { roleWriteErrorMessage } from "./messages"
import { RoleForm } from "./role-form"

export function NewRoleDialog() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="default">
            <Plus className="h-4 w-4" />
            New role
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create role</DialogTitle>
          <DialogDescription>
            Name the role and pick the permissions it should grant.
          </DialogDescription>
        </DialogHeader>
        <RoleForm
          defaultValues={{ name: "", permissions: [] }}
          submitLabel="Create role"
          onCancel={() => setOpen(false)}
          onSubmit={async (values) => {
            const [error] = await fetchData<TenantRole>("/api/tenants/roles", {
              method: "POST",
              body: values,
            })

            if (error) return roleWriteErrorMessage(error.status)

            toast.success("Role created.")
            setOpen(false)
            router.refresh()
            return null
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
