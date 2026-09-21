"use client"

import { useForm } from "@tanstack/react-form"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { SitePicker } from "@/components/site-picker"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fetchData } from "@/lib/data/data-fetch"
import { ClaimResult } from "@/types/responses"
import { claimMachineSchema } from "@vmaas/shared/schemas"

import { claimErrorMessage } from "./claim"

/**
 * Mirrors `z.input<typeof claimMachineSchema.shape.body>`. TanStack Form matches
 * the validator's input type invariantly, so both fields are required here
 * exactly as they are in the schema.
 *
 * `siteId` is `""` until the picker has a selection — the schema's uuid check is
 * what turns that into the "site is required" message.
 */
export type ClaimFormValues = {
  serialNumber: string
  siteId: string
}

/**
 * Binds a machine that already exists in the platform to this tenant and a site.
 *
 * There is no `name` field: the machine was registered by serial number before
 * it shipped and already carries one. The tenant is not a field either — it
 * comes from the session, which is what makes this the customer's own action.
 *
 * @param onClaimed Handed the response so the dialog can show the one-time code,
 *        which exists nowhere else: only its hash is stored.
 */
export function ClaimMachineForm({
  onCancel,
  onClaimed,
}: {
  onCancel: () => void
  onClaimed: (result: ClaimResult, values: ClaimFormValues) => void
}) {
  const router = useRouter()

  const form = useForm({
    defaultValues: { serialNumber: "", siteId: "" } as ClaimFormValues,
    validators: {
      onSubmit: claimMachineSchema.shape.body,
    },
    onSubmit: async ({ value }) => {
      const [error, result] = await fetchData<ClaimResult>(
        "/api/machines/claim",
        {
          method: "POST",
          body: { serialNumber: value.serialNumber, siteId: value.siteId },
        }
      )

      // Branching on error.status, not error.reason. clientFetch sets `reason`
      // to response.statusText - "Not Found", never "NOT_FOUND", and an empty
      // string over HTTP/2 - so a switch over symbolic names matches nothing
      // and falls through to its default. The status code is the only part of
      // HttpError that carries meaning.
      if (error) {
        if (error.status === 403) {
          // The page's own permission gate redirects to /forbidden, so a 403
          // here is the backend denying the write; without this the button
          // would simply go quiet.
          router.push(
            "/forbidden?reason=" +
              encodeURIComponent("You do not have permission to claim machines.")
          )
          return
        }
        if (error.status === 401) {
          router.push("/login")
          return
        }
        toast.error(claimErrorMessage(error.status))
        return
      }

      onClaimed(result, value)
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
        <form.Field name="serialNumber">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Serial number*</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  // Serial numbers are printed in upper case and the label on
                  // the machine is what gets typed; folding the case here means
                  // a lower-case entry is not a 404 the user cannot explain.
                  onChange={(e) =>
                    field.handleChange(e.target.value.toUpperCase())
                  }
                  aria-invalid={isInvalid}
                  placeholder="e.g. VM-16FEE909"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        {/* The picker holds the site's *name* in its input and hands back the
            row; the field itself only ever stores the id, which is what the
            endpoint takes. */}
        <form.Field name="siteId">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Site*</FieldLabel>
                <SitePicker
                  id={field.name}
                  name={field.name}
                  onSelect={(site) => {
                    field.handleChange(site?.id ?? "")
                    // Picking is this field's equivalent of blurring an input —
                    // without it the error only appears after a submit attempt.
                    field.handleBlur()
                  }}
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
                Claim machine
              </Button>
            )}
          </form.Subscribe>
        </div>
      </FieldGroup>
    </form>
  )
}
