import { Suspense } from "react"
import { notFound } from "next/navigation"

import { RoleGate } from "@/components/role-gate"
import { Badge } from "@/components/ui/badge"
import { requirePermission } from "@/lib/dal"
import { formatDate } from "@/lib/utils"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { sitesErrorMessage } from "../messages"
import BentoGrid from "./bento-grid"
import { SiteActions } from "./site-actions"
import { fetchData } from "@/lib/data/data-fetch"
// Type-only: `../form` is a client module, and these two never cross as values.
import type { SiteDetail, SiteFormValues } from "../form"

export const NO_READ_ACCESS = "You do not have access to sites."

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

  // The same pair as numbers, for the location card and the map in the edit
  // dialog. `Number` is what turns the serialised Decimal back into a
  // coordinate; a pair that does not parse is treated as no pin rather than as
  // NaN reaching MapLibre.
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
    <>
      {/* Same title row as the sites list, with the edit/delete triggers where
          that page puts its "New site" dialog. */}
      <div className="flex w-full justify-between">
        <div className="mb-6">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            {site.name}
            {machineCount > 0 && (
              <Badge variant="secondary">
                {machineCount} machine{machineCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground">
            Created {formatDate(site.createdAt)}
          </p>
        </div>
        {/* Hiding the buttons for a read-only user must not take the page away,
            hence performRedirect={false}. */}
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
      </div>

      <BentoGrid
        site={site}
        coordinates={coordinates}
        latitude={hasPin ? latitude : null}
        longitude={hasPin ? longitude : null}
      />
    </>
  )
}
