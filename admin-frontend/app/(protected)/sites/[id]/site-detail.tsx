import { Suspense } from "react"
import { notFound } from "next/navigation"

import { RoleGate } from "@/components/role-gate"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requirePermission } from "@/lib/dal"
import { formatDate } from "@/lib/utils"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { sitesErrorMessage } from "../messages"
import { SiteActions } from "./site-actions"
import { fetchData } from "@/lib/data/data-fetch"
// Type-only: `../form` is a client module, and these two never cross as values.
import type { SiteDetail, SiteFormValues } from "../form"

export const NO_READ_ACCESS = "You do not have access to sites."

/** One `<dl>` row. Renders a dash rather than nothing when the column is null,
 *  so the grid keeps its shape whatever the site has filled in. */
function DetailRow({
  label,
  value,
  className,
}: {
  label: string
  value: string | null
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  )
}

/**
 * Reads one site and renders it.
 *
 * The permission is re-checked here rather than trusted from the <RoleGate>
 * around it: the gate decides what to render, this is what guards the data. The
 * tenant comes from that gate and never from the URL, so a site id from another
 * tenant reads as 404.
 */
export async function SiteDetailLoader({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requirePermission(PERMISSIONS.SITE_READ, NO_READ_ACCESS)

  const [error, site] = await fetchData<SiteDetail>(`/api/sites/${id}`)

  if (error) {
    if (error.reason === "NOT_FOUND") notFound()

    return (
      <p role="alert" className="text-sm text-destructive">
        {sitesErrorMessage(error.status)}
      </p>
    )
  }

  const { machineCount } = site
  // Typed `Decimal`, but both arrive over JSON as strings.
  const coordinates =
    site.latitude !== null && site.longitude !== null
      ? `${site.latitude}, ${site.longitude}`
      : null

  // The same pair as numbers, for the map in the edit dialog. `Number` is what
  // turns the serialised Decimal back into a coordinate; a pair that does not
  // parse is treated as no pin rather than as NaN reaching MapLibre.
  const latitude = Number(site.latitude)
  const longitude = Number(site.longitude)
  const hasPin =
    coordinates !== null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)

  // Narrowed to plain values before crossing the client boundary: this server
  // component holds Prisma's `Decimal` and `Date` fields, and the edit form
  // wants the text columns with null as an empty input, and the coordinates as
  // numbers — or null, which is what clears them on save.
  const formValues: SiteFormValues = {
    name: site.name,
    addressLine1: site.addressLine1 ?? "",
    addressLine2: site.addressLine2 ?? "",
    postalCode: site.postalCode ?? "",
    city: site.city ?? "",
    countryCode: site.countryCode ?? "",
    contactName: site.contactName ?? "",
    contactPhone: site.contactPhone ?? "",
    contactEmail: site.contactEmail ?? "",
    latitude: hasPin ? latitude : null,
    longitude: hasPin ? longitude : null,
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-2xl">
          {site.name}
          {machineCount > 0 && (
            <Badge variant="secondary">
              {machineCount} machine{machineCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Created {formatDate(site.createdAt)}</CardDescription>

        {/* Hiding the buttons for a read-only user must not take the page away,
            hence performRedirect={false}. */}
        <CardAction>
          <Suspense>
            <RoleGate perms={[PERMISSIONS.SITE_WRITE]} performRedirect={false}>
              <SiteActions
                id={site.id}
                name={site.name}
                defaultValues={formValues}
                canDelete={site.canDelete}
              />
            </RoleGate>
          </Suspense>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6">
        <div>
          <h2 className="mb-2 text-sm font-medium">Address</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Address line 1" value={site.addressLine1} />
            <DetailRow label="Address line 2" value={site.addressLine2} />
            <DetailRow label="Postal code" value={site.postalCode} />
            <DetailRow label="City" value={site.city} />
            <DetailRow label="Country code" value={site.countryCode} />
            <DetailRow label="Coordinates" value={coordinates} />
          </dl>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Contact</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Name" value={site.contactName} />
            <DetailRow label="Phone" value={site.contactPhone} />
            <DetailRow label="Email" value={site.contactEmail} />
          </dl>
        </div>

        <dl className="grid gap-4 sm:grid-cols-2">
          <DetailRow label="Machines" value={String(machineCount)} />
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">ID</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              {site.id}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
