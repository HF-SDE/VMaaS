"use client"

import { useForm } from "@tanstack/react-form"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createMachineSchema } from "@vmaas/shared/schemas"
import { fetchData } from "@/lib/data/data-fetch"
import { MachineUsage } from "@vmaas/shared/types/machine"
import { Machine } from "@prisma"
import { machineWriteErrorMessage } from "./messages"

/**
 * What `GET`/`PATCH /api/machines/:id` answer with — the row plus its usage
 * flags. Composed here rather than in `@vmaas/shared/types/machine`, because the
 * `@prisma` alias that `Machine` comes from only exists in this package.
 */
export type MachineDetail = Machine & MachineUsage

/**
 * Mirrors `z.input<typeof createMachineSchema.shape.body>`. TanStack Form
 * matches the validator's input type against this one invariantly, so `location`
 * has to be optional here exactly as it is in the schema — a required `string`
 * makes the validator below stop type-checking.
 */
export type MachineFormValues = {
  name: string
  location?: string
}

type MachineFormProps = {
  defaultValues: MachineFormValues
  submitLabel: string
  onCancel: () => void
  /** Resolves to an error message to show, or null when the write succeeded. */
  onSubmit: (values: MachineFormValues) => Promise<string | null>
}

/**
 * The fields shared by creating and editing a machine.
 *
 * It owns validation and the submitting state but not what submitting *does* —
 * the caller passes that in, so one set of fields serves both the new-machine
 * dialog and the edit dialog on a machine's page.
 *
 * `createMachineSchema.shape.body` is reused as the validator for both: the edit
 * endpoint accepts partial input, but this form always sends both fields, so
 * requiring a name here is what the user should actually be held to. `location`
 * stays optional on both sides — it is nullable in the database, so a machine
 * can be registered before it is placed.
 *
 * `status` is not a field: the firmware reports it, an admin does not set it.
 */
export function MachineForm({
  defaultValues,
  submitLabel,
  onCancel,
  onSubmit,
}: MachineFormProps) {
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: createMachineSchema.shape.body,
    },

    onSubmit: async ({ value }) => {
      const message = await onSubmit({
        name: value.name,
        location: value.location,
      })
      if (message) toast.error(message)
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

        <form.Field name="location">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Location</FieldLabel>
                <Input
                  type="text"
                  id={field.name}
                  name={field.name}
                  value={field.state.value ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="e.g. Building A, 2nd floor"
                  autoComplete="off"
                />

                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onCancel()}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                {submitLabel}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </FieldGroup>
    </form>
  )
}

export function CreateMachineForm({
  triggerCloseDialog,
}: {
  triggerCloseDialog: () => void
}) {
  const router = useRouter()

  return (
    <MachineForm
      defaultValues={{ name: "", location: "" }}
      submitLabel="Create machine"
      onCancel={triggerCloseDialog}
      onSubmit={async (values) => {
        // A blank location is sent as "" and normalised to "no location" by
        // createMachineSchema, so the client does not have to decide between
        // omitting the key and sending an empty one.
        const [error, machine] = await fetchData<Machine>("/api/machines", {
          method: "POST",
          body: { name: values.name, location: values.location },
        })

        // The action's own permission gate redirects to /forbidden, so a
        // `forbidden` here means the backend itself denied the write — no
        // redirect happens there, which would otherwise leave the button silent.
        if (error) {
          const reason = error.reason
          switch (reason) {
            case "FORBIDDEN":
              router.push(
                "/forbidden?reason=" +
                  encodeURIComponent(
                    "You do not have permission to create machines."
                  )
              )
              break
            case "UNAUTHORIZED":
              router.push("/login")
              break
            // No NOT_FOUND or CONFLICT arm: POST /api/machines answers neither,
            // so CreateMachineError does not carry them.
            case "BAD_REQUEST":
            case "BACKEND_ERROR":
            case "NETWORK_ERROR":
              toast.error(machineWriteErrorMessage(error.status))
              break
            default:
              throw new Error(`Unhandled error - reason: ${reason}`)
          }
        } else {
          triggerCloseDialog()
          router.push("/machines/" + machine.id)
        }
        return null
      }}
    />
  )
}

export function EditMachineForm({
  id,
  defaultValues,
  onSaved,
  onCancel,
}: {
  id: string
  defaultValues: MachineFormValues
  onSaved: () => void
  onCancel: () => void
}) {
  const router = useRouter()

  return (
    <MachineForm
      defaultValues={defaultValues}
      submitLabel="Save changes"
      onCancel={onCancel}
      onSubmit={async (values) => {
        // Emptying the location field is a clear, not a no-op: updateMachineSchema
        // turns the "" into a null so the nullable column is actually reset.
        const [error] = await fetchData<MachineDetail>(`/api/machines/${id}`, {
          method: "PATCH",
          body: { name: values.name, location: values.location },
        })

        if (error) return machineWriteErrorMessage(error.status)

        toast.success("Machine saved.")
        onSaved()
        // The action revalidated the path; this is what makes the open page
        // re-render with the saved values.
        router.refresh()
        return null
      }}
    />
  )
}
