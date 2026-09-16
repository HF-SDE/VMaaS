"use client"

import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { inviteMemberSchema } from "@vmaas/shared/schemas"
import { fetchData } from "@/lib/data/data-fetch"

import { memberInviteErrorMessage } from "./messages"
import { TenantRole } from "./page"

/**
 * Mirrors `z.input<typeof inviteMemberSchema>`. TanStack Form matches the
 * validator's input type against this one invariantly, so both fields are
 * required here exactly as they are in the schema.
 *
 * `role` is `""` until the select has a value — the schema's `min(1)` is what
 * turns that into the "Select a role" message.
 */
type InviteFormValues = {
  email: string
  role: string
}

/** The statuses that are about the invited person rather than the request. They
 *  are shown under the email field instead of in a toast, because the field is
 *  what the user has to change to get past them. */
const EMAIL_STATUSES = [404, 409]

export function InviteMemberForm({
  tenantRoles,
  triggerCloseDialog,
}: {
  tenantRoles: TenantRole[]
  triggerCloseDialog: () => void
}) {
  const router = useRouter()
  /** A server-side rejection of the address itself. The form's own validator
   *  cannot know it, so it is held here and cleared as soon as the email is
   *  edited — otherwise the message would outlive the address it named. */
  const [emailError, setEmailError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: "", role: "" } as InviteFormValues,
    validators: {
      onSubmit: inviteMemberSchema,
    },

    onSubmit: async ({ value }) => {
      setEmailError(null)

      const [error] = await fetchData("/api/tenants/members", {
        method: "POST",
        body: { email: value.email, role: value.role },
      })

      if (!error) {
        toast.success(`Invitation sent to ${value.email}.`)
        // Nothing to refresh: the table lists members, and the invited user only
        // becomes one once they accept.
        triggerCloseDialog()
        return
      }

      if (error.status === 401) {
        router.push("/login")
        return
      }

      const message = memberInviteErrorMessage(error.status, value.email)

      if (EMAIL_STATUSES.includes(error.status)) setEmailError(message)
      else toast.error(message)
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
        <form.Field name="email">
          {(field) => {
            const isInvalid =
              (field.state.meta.isTouched && !field.state.meta.isValid) ||
              emailError !== null
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Email*</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    setEmailError(null)
                    field.handleChange(e.target.value)
                  }}
                  aria-invalid={isInvalid}
                  placeholder="name@example.com"
                  autoComplete="off"
                />
                {emailError ? (
                  <FieldError>{emailError}</FieldError>
                ) : (
                  isInvalid && <FieldError errors={field.state.meta.errors} />
                )}
                <FieldDescription>
                  The person must already have a VMaaS account.
                </FieldDescription>
              </Field>
            )
          }}
        </form.Field>

        {/* The select holds `null` while nothing is picked, which is what shows
            the placeholder; the field itself stores "" for that, so the schema
            is what reports a missing role rather than a separate check here. */}
        <form.Field name="role">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Role*</FieldLabel>
                <Select
                  items={tenantRoles.map((role) => ({
                    value: role.name,
                    label: role.name,
                  }))}
                  value={field.state.value || null}
                  onValueChange={(value) => {
                    field.handleChange(value ?? "")
                    // Picking is this field's equivalent of blurring an input —
                    // without it the error only appears after a submit attempt.
                    field.handleBlur()
                  }}
                >
                  <SelectTrigger
                    id={field.name}
                    className="w-full capitalize"
                    aria-invalid={isInvalid}
                  >
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {tenantRoles.map((role) => (
                        <SelectItem
                          key={role.id}
                          value={role.name}
                          className="capitalize"
                        >
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => triggerCloseDialog()}
          >
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Send invitation
              </Button>
            )}
          </form.Subscribe>
        </div>
      </FieldGroup>
    </form>
  )
}
