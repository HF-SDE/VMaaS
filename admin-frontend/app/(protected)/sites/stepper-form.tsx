"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { useForm } from "@tanstack/react-form"
import { cn } from "cn"
import { ArrowBigDown, Check, Loader2, MapPin } from "lucide-react"
import { toast } from "sonner"

import { createSiteSchema } from "@vmaas/shared/schemas"

import {
  AddressSearch,
  type AddressSuggestion,
} from "@/components/address-search"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TextField, type SiteFormValues } from "./form"

/** MapLibre is a large dependency, and most visits to a sites page never open
 *  one of these dialogs — let alone reach the address step. Loading it on
 *  demand keeps it out of the page's initial bundle. `ssr: false` because the
 *  map reads `window`. */
const SiteLocationMap = dynamic(
  () => import("./site-location-map").then((m) => m.SiteLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full rounded-md" /> }
)

/** A pin on the map, once both halves of the pair are known. */
type SiteLocation = { latitude: number; longitude: number }

/**
 * The pin a set of form values describes, or `null` for a site with no stored
 * position. Half a pair locates nothing and the write schema rejects it, so
 * only a complete one counts.
 */
function locationOf(values: SiteFormValues): SiteLocation | null {
  const { latitude, longitude } = values

  return typeof latitude === "number" && typeof longitude === "number"
    ? { latitude, longitude }
    : null
}

/**
 * The steps, in order, with the fields each one owns.
 *
 * The field lists are what drive the locking below, so a field added to the
 * form has to be listed here too or it will never block a step.
 */
const STEPS = [
  { value: "general", label: "General", fields: ["name"] },
  {
    value: "contact",
    label: "Contact",
    fields: ["contactName", "contactPhone", "contactEmail"],
  },
  {
    value: "address",
    label: "Address",
    fields: [
      "addressLine1",
      "addressLine2",
      "postalCode",
      "city",
      "countryCode",
    ],
  },
  { value: "confirm", label: "Confirm", fields: [] },
] as const satisfies readonly {
  value: string
  label: string
  fields: readonly (keyof SiteFormValues)[]
}[]

const ADDRESS_STEP = 2
const LAST_STEP = STEPS.length - 1

/**
 * The index of the first step the create schema rejects, or `-1` when every
 * step is satisfied.
 *
 * One parse of the whole body answers it for all steps at once, and the issue
 * paths say which field — and so which step — is at fault. Step 1 is invalid
 * while the name is blank, which is exactly the "lock the rest until General is
 * filled" rule; the later steps are optional, so they only block on something
 * genuinely malformed such as a bad email or a three-letter country code.
 */
function firstInvalidStep(values: SiteFormValues): number {
  const result = createSiteSchema.shape.body.safeParse(values)
  if (result.success) return -1

  const invalid = new Set(
    result.error.issues.map((issue) => String(issue.path[0]))
  )

  return STEPS.findIndex((step) =>
    step.fields.some((field) => invalid.has(field))
  )
}

function joinParts(parts: Array<string | undefined>, separator: string) {
  const present = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(separator) : undefined
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      {/* An address or an email has no break opportunity the row can rely on,
          and one long value would otherwise widen the whole summary. */}
      <span className="min-w-0 text-right text-sm font-medium wrap-break-word">
        {value || <span className="text-muted-foreground">Not set</span>}
      </span>
    </div>
  )
}

type StepNavProps = {
  step: number
  submitLabel: string
  isSubmitting: boolean
  canContinue: boolean
  onBack: () => void
  onNext: () => void
  onCancel: () => void
}

function StepNav({
  step,
  submitLabel,
  isSubmitting,
  canContinue,
  onBack,
  onNext,
  onCancel,
}: StepNavProps) {
  return (
    <div className="flex items-center justify-between gap-2 border-t pt-4">
      <Button
        type="button"
        variant="ghost"
        onClick={step === 0 ? onCancel : onBack}
        disabled={isSubmitting}
      >
        {step === 0 ? "Cancel" : "Back"}
      </Button>

      {step === LAST_STEP ? (
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      ) : (
        <Button type="button" onClick={onNext} disabled={!canContinue}>
          Next
        </Button>
      )}
    </div>
  )
}

type SiteStepperFormProps = {
  /** Includes `latitude` / `longitude`, so editing a site that already has a
   *  position opens the map on it rather than on an empty state. */
  defaultValues: SiteFormValues
  submitLabel: string
  onCancel: () => void
  /** Resolves to an error message to show, or null when the write succeeded. */
  onSubmit: (values: SiteFormValues) => Promise<string | null>
}

/**
 * The site fields, split across four tabs used as a stepper: the required
 * general info, then optional contact details, then the address, then a
 * summary to confirm.
 *
 * It owns validation, the step locking and the submitting state but not what
 * submitting *does* — the caller passes that in, so one stepper serves both the
 * new-site dialog and the edit dialog on a site's page.
 *
 * All four panels stay mounted so a half-typed field, the address search's own
 * query and the scroll position survive stepping back and forth; only the map
 * is rendered conditionally, because a MapLibre canvas in a `display: none`
 * panel initialises at zero size.
 *
 * The coordinates live in the form values rather than in state beside them, so
 * the pin has one source of truth: the map reads what will be submitted, and a
 * site opened for editing shows its stored position immediately.
 */
export function SiteStepperForm({
  defaultValues,
  submitLabel,
  onCancel,
  onSubmit,
}: SiteStepperFormProps) {
  const [step, setStep] = useState(0)

  const form = useForm({
    defaultValues,
    validators: {
      // Validated on change rather than only on submit: the step locking reads
      // the same schema, so a malformed email has to be known before the user
      // asks for the next step.
      onChange: createSiteSchema.shape.body,
    },

    onSubmit: async ({ value }) => {
      const message = await onSubmit(value)
      if (message) toast.error(message)
    },
  })

  /**
   * Copies a picked suggestion into the address fields. The country code is
   * only taken when it is the two letters the schema accepts, so an oddly
   * tagged OSM feature cannot make the form unsubmittable behind a field the
   * user never typed in.
   */
  function applyAddress(address: AddressSuggestion | null) {
    // A cleared selection only drops the pin: the fields may have been edited
    // by hand since, and throwing that away is not what clearing a search box
    // asks for. `null` rather than `undefined` so the write actually clears a
    // stored position instead of leaving the old one behind.
    if (!address) {
      form.setFieldValue("latitude", null)
      form.setFieldValue("longitude", null)
      return
    }

    form.setFieldValue("latitude", address.latitude)
    form.setFieldValue("longitude", address.longitude)
    form.setFieldValue("addressLine1", address.addressLine1 ?? "")
    form.setFieldValue("postalCode", address.postcode ?? "")
    form.setFieldValue("city", address.city ?? "")
    form.setFieldValue(
      "countryCode",
      address.countryCode?.length === 2 ? address.countryCode.toUpperCase() : ""
    )
  }

  return (
    // A named container, not viewport breakpoints: this form lives in a dialog
    // whose width has nothing to do with the window's, so `sm:` would keep the
    // tab labels and the three-column address row at full size inside a narrow
    // box. `min-w-0` lets it shrink below its content's min-content width
    // instead of overflowing the dialog's grid track.
    <form
      className="@container/stepper min-w-0"
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
    >
      <form.Subscribe
        selector={(state) => ({
          values: state.values,
          isSubmitting: state.isSubmitting,
        })}
      >
        {({ values, isSubmitting }) => {
          // Everything up to and including the first step with a problem stays
          // reachable; the rest is locked. Clamping the active step to it means
          // breaking the email while standing on Confirm walks the user back to
          // Contact instead of stranding them on a disabled tab.
          const blockedAt = firstInvalidStep(values)
          const maxStep = blockedAt === -1 ? LAST_STEP : blockedAt
          const current = Math.min(step, maxStep)

          const address = joinParts(
            [
              values.addressLine1,
              values.addressLine2,
              joinParts([values.postalCode, values.city], " "),
              values.countryCode,
            ],
            ", "
          )
          const contact = joinParts(
            [values.contactName, values.contactPhone, values.contactEmail],
            " · "
          )
          const pinLabel = values.name.trim() || address
          const location = locationOf(values)

          return (
            <Tabs
              value={STEPS[current].value}
              onValueChange={(value) => {
                const index = STEPS.findIndex((s) => s.value === value)
                if (index !== -1) setStep(index)
              }}
              className="min-w-0 gap-6"
            >
              <TabsList className="w-full">
                {STEPS.map((s, index) => (
                  <TabsTrigger
                    key={s.value}
                    value={s.value}
                    disabled={index > maxStep}
                    // The triggers are `whitespace-nowrap`, so without this
                    // they refuse to shrink below their labels and the strip
                    // pushes out of the dialog.
                    className="min-w-0"
                  >
                    {/* The tick replaces the number once the step is behind
                        the user and still parses. */}
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        index < current
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted-foreground/20"
                      )}
                    >
                      {index < current ? (
                        <Check className="size-3" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {/* Below this the strip is numbers only — four labels do
                        not fit, and a truncated "Gen…" helps nobody. */}
                    <span className="hidden truncate @md/stepper:inline">
                      {s.label}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* Panels stay mounted so nothing is retyped or re-fetched when
                  the user steps back. */}
              <TabsContent value="general" keepMounted>
                <FieldGroup>
                  <FieldDescription>
                    The only thing a site needs to exist. Everything after this
                    step is optional.
                  </FieldDescription>
                  <form.Field name="name">
                    {(field) => (
                      <TextField
                        field={field}
                        label="Name*"
                        placeholder="Warehouse North"
                      />
                    )}
                  </form.Field>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="contact" keepMounted>
                <FieldGroup>
                  <FieldDescription>
                    Who to reach about this site. All optional.
                  </FieldDescription>
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
                </FieldGroup>
              </TabsContent>

              <TabsContent value="address" keepMounted>
                <FieldGroup>
                  <Field orientation="vertical">
                    <FieldLabel htmlFor="site-address-search">
                      Search for an address
                    </FieldLabel>
                    <AddressSearch
                      id="site-address-search"
                      defaultValue={
                        joinParts(
                          [
                            defaultValues.addressLine1,
                            joinParts(
                              [defaultValues.postalCode, defaultValues.city],
                              " "
                            ),
                          ],
                          ", "
                        ) ?? ""
                      }
                      onSelect={applyAddress}
                    />
                    <FieldDescription>
                      Picking a result fills in the fields below and drops a
                      pin. You can also type them yourself.
                    </FieldDescription>
                  </Field>

                  {location && current === ADDRESS_STEP && (
                    <SiteLocationMap
                      latitude={location.latitude}
                      longitude={location.longitude}
                    />
                  )}

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
                  <div className="grid gap-4 @md/stepper:grid-cols-3">
                    <form.Field name="postalCode">
                      {(field) => (
                        <TextField
                          field={field}
                          label="Postal code"
                          placeholder="5700"
                        />
                      )}
                    </form.Field>
                    <form.Field name="city">
                      {(field) => (
                        <TextField
                          field={field}
                          label="City"
                          placeholder="Svendborg"
                        />
                      )}
                    </form.Field>
                    <form.Field name="countryCode">
                      {(field) => (
                        <TextField
                          field={field}
                          label="Country code"
                          placeholder="DK"
                        />
                      )}
                    </form.Field>
                  </div>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="confirm" keepMounted>
                <div className="flex flex-col gap-4">
                  {location && current === LAST_STEP ? (
                    <SiteLocationMap
                      latitude={location.latitude}
                      longitude={location.longitude}
                      label={pinLabel}
                      className="h-44"
                    />
                  ) : (
                    <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 text-sm text-muted-foreground">
                      <MapPin className="size-5" />
                      No location picked
                    </div>
                  )}

                  <div className="divide-y rounded-md border px-4 py-1">
                    <SummaryRow label="Name" value={values.name.trim()} />
                    <SummaryRow label="Contact" value={contact} />
                    <SummaryRow label="Address" value={address} />
                  </div>
                </div>
              </TabsContent>

              <StepNav
                step={current}
                submitLabel={submitLabel}
                isSubmitting={isSubmitting}
                canContinue={current < maxStep}
                onBack={() => setStep(current - 1)}
                onNext={() => setStep(current + 1)}
                onCancel={onCancel}
              />
            </Tabs>
          )
        }}
      </form.Subscribe>
    </form>
  )
}
