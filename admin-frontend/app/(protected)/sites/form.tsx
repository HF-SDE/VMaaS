"use client"

import { useForm, type AnyFieldApi } from "@tanstack/react-form"
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
import { createSiteSchema } from "@vmaas/shared/schemas"
import { fetchData } from "@/lib/data/data-fetch"
import { SiteUsage } from "@vmaas/shared/types/site"
import { Site } from "@prisma"
import { siteWriteErrorMessage } from "./messages"

/**
 * What `GET`/`PATCH /api/sites/:id` answer with — the row plus its usage
 * flags. Composed here rather than in `@vmaas/shared/types/site`, because the
 * `@prisma` alias that `Site` comes from only exists in this package.
 */
export type SiteDetail = Site & SiteUsage

/**
 * Mirrors `z.input<typeof createSiteSchema.shape.body>`. TanStack Form matches
 * the validator's input type against this one invariantly, so every field that
 * is optional in the schema has to be optional here too — a required `string`
 * makes the validator below stop type-checking.
 */
export type SiteFormValues = {
  name: string
  addressLine1?: string
  addressLine2?: string
  postalCode?: string
  city?: string
  countryCode?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
}

/** Every field blank — what the create dialog starts from. */
export const EMPTY_SITE: SiteFormValues = {
  name: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  city: "",
  countryCode: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
}

/**
 * One labelled text input, bound to a TanStack field.
 *
 * Typed as `AnyFieldApi` rather than the exact field type: the nine fields
 * below differ only in their name and label, and spelling out each generic
 * would be nine near-identical signatures for no extra safety — `form.Field`
 * has already checked the name against `SiteFormValues` by the time this runs.
 */
function TextField({
  field,
  label,
  placeholder,
  type = "text",
}: {
  field: AnyFieldApi
  label: string
  placeholder?: string
  type?: string
}) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid} orientation="vertical">
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        // The schema leaves optional fields as `string | undefined`, and an
        // undefined `value` would make this an uncontrolled input.
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        placeholder={placeholder}
        autoComplete="off"
      />
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}

type SiteFormProps = {
  defaultValues: SiteFormValues
  submitLabel: string
  onCancel: () => void
  /** Resolves to an error message to show, or null when the write succeeded. */
  onSubmit: (values: SiteFormValues) => Promise<string | null>
}

/**
 * The fields shared by creating and editing a site.
 *
 * It owns validation and the submitting state but not what submitting *does* —
 * the caller passes that in, so one set of fields serves both the new-site
 * dialog and the edit dialog on a site's page.
 *
 * `createSiteSchema.shape.body` is reused as the validator for both: the edit
 * endpoint accepts partial input, but this form always sends every field, so
 * requiring a name here is what the user should actually be held to. Everything
 * else stays optional on both sides — the columns are nullable, so a site can
 * be created from a name alone and filled in later.
 */
export function SiteForm({
  defaultValues,
  submitLabel,
  onCancel,
  onSubmit,
}: SiteFormProps) {
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: createSiteSchema.shape.body,
    },

    onSubmit: async ({ value }) => {
      const message = await onSubmit(value)
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
          {(field) => (
            <TextField
              field={field}
              label="Name*"
              placeholder="Warehouse North"
            />
          )}
        </form.Field>

        <form.Field name="addressLine1">
          {(field) => (
            <TextField
              field={field}
              label="Address line 1"
              placeholder="Kullinggade 6A"
            />
          )}
        </form.Field>

        <form.Field name="addressLine2">
          {(field) => (
            <TextField
              field={field}
              label="Address line 2"
              placeholder="Building B, 2nd floor"
            />
          )}
        </form.Field>

        <form.Field name="postalCode">
          {(field) => (
            <TextField field={field} label="Postal code" placeholder="5700" />
          )}
        </form.Field>

        <form.Field name="city">
          {(field) => (
            <TextField field={field} label="City" placeholder="Svendborg" />
          )}
        </form.Field>

        <form.Field name="countryCode">
          {(field) => (
            <TextField field={field} label="Country code" placeholder="DK" />
          )}
        </form.Field>

        <form.Field name="contactName">
          {(field) => (
            <TextField
              field={field}
              label="Contact name"
              placeholder="Jane Jensen"
            />
          )}
        </form.Field>

        <form.Field name="contactPhone">
          {(field) => (
            <TextField
              field={field}
              label="Contact phone"
              type="tel"
              placeholder="+45 12 34 56 78"
            />
          )}
        </form.Field>

        <form.Field name="contactEmail">
          {(field) => (
            <TextField
              field={field}
              label="Contact email"
              type="email"
              placeholder="jane@example.com"
            />
          )}
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

export function CreateSiteForm({
  triggerCloseDialog,
}: {
  triggerCloseDialog: () => void
}) {
  const router = useRouter()

  return (
    <SiteForm
      defaultValues={EMPTY_SITE}
      submitLabel="Create Site"
      onCancel={triggerCloseDialog}
      onSubmit={async (values) => {
        const [error, site] = await fetchData<Site>("/api/sites", {
          method: "POST",
          body: values,
        })

        // The page's own permission gate redirects to /forbidden, so a
        // `forbidden` here means the backend itself denied the write — no
        // redirect happens there, which would otherwise leave the button silent.
        if (error) {
          const reason = error.reason
          switch (reason) {
            case "FORBIDDEN":
              router.push(
                "/forbidden?reason=" +
                  encodeURIComponent(
                    "You do not have permission to create sites."
                  )
              )
              break
            case "UNAUTHORIZED":
              router.push("/login")
              break
            // No NOT_FOUND or CONFLICT arm: POST /api/sites answers neither.
            case "BAD_REQUEST":
            case "BACKEND_ERROR":
            case "NETWORK_ERROR":
              toast.error(siteWriteErrorMessage(error.status))
              break
            default:
              throw new Error(`Unhandled error - reason: ${reason}`)
          }
        } else {
          triggerCloseDialog()
          router.push("/sites/" + site.id)
        }
        return null
      }}
    />
  )
}

export function EditSiteForm({
  id,
  defaultValues,
  onSaved,
  onCancel,
}: {
  id: string
  defaultValues: SiteFormValues
  onSaved: () => void
  onCancel: () => void
}) {
  const router = useRouter()

  return (
    <SiteForm
      defaultValues={defaultValues}
      submitLabel="Save changes"
      onCancel={onCancel}
      onSubmit={async (values) => {
        const [error] = await fetchData<SiteDetail>(`/api/sites/${id}`, {
          method: "PATCH",
          body: values,
        })

        if (error) return siteWriteErrorMessage(error.status)

        toast.success("Site saved.")
        onSaved()
        // This is what makes the open page re-render with the saved values.
        router.refresh()
        return null
      }}
    />
  )
}
