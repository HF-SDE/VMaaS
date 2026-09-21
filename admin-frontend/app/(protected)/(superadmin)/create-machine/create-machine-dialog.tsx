"use client"

import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fetchData } from "@/lib/data/data-fetch"
import { createMachineSchema } from "@vmaas/shared/schemas"

import { createMachineErrorMessage } from "./messages"

/** Mirrors `z.input<typeof createMachineSchema.shape.body>`. */
type CreateMachineFormValues = {
  name: string
}

/**
 * Creates a machine with neither a tenant nor a site. It then shows up in the
 * list on this page, and a tenant gets it later by claiming its serial number.
 */
export function CreateMachineDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="default">Create machine</Button>} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create machine</DialogTitle>
          <DialogDescription>
            The machine gets a generated serial number. Its tenant and site are
            set when a tenant claims it.
          </DialogDescription>
        </DialogHeader>

        <CreateMachineForm onCancel={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function CreateMachineForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter()

  const form = useForm({
    defaultValues: { name: "" } as CreateMachineFormValues,
    validators: {
      onSubmit: createMachineSchema.shape.body,
    },
    onSubmit: async ({ value }) => {
      const [error, machine] = await fetchData<{ id: string }>(
        "/api/machines",
        { method: "POST", body: { name: value.name } }
      )

      // Branching on error.status, not error.reason — see claim-form.tsx.
      if (error) {
        if (error.status === 401) {
          router.push("/login")
          return
        }
        toast.error(createMachineErrorMessage(error.status))
        return
      }

      toast.success("Machine created.")

      router.push(`/create-machine/${machine.id}`)
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldGroup>
        <form.Field name="name">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Name*</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="e.g. Canteen machine"
                  autoComplete="off"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Create machine
              </Button>
            )}
          </form.Subscribe>
        </div>
      </FieldGroup>
    </form>
  )
}
