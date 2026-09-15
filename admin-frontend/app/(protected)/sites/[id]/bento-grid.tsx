import { ContactsCard } from "./cards/contacts-card"
import { GeneralCard } from "./cards/general-card"
import { LocationCard } from "./cards/location-card"
import { MachineCountCard } from "./cards/machine-count-card"
import { PlaceholderCard } from "./cards/placeholder-card"
// Type-only: `../form` is a client module, and these never cross as values.
import type { SiteDetail } from "../form"

type BentoGridProps = {
  site: SiteDetail
  /** Formatted by the page, which holds the `Decimal` pair. */
  coordinates: string | null
  /** Both or neither — `null` when the site has no usable pin. */
  latitude: number | null
  longitude: number | null
}

/** The address as it would be written on an envelope, skipping the columns the
 *  site left blank. */
function addressLines(site: SiteDetail): string[] {
  return [
    site.addressLine1,
    site.addressLine2,
    [site.postalCode, site.city].filter(Boolean).join(" "),
    site.countryCode,
  ].filter((line): line is string => Boolean(line))
}

/**
 * Everything known about one site, a card per subject.
 *
 * The spans below are what makes it a bento rather than a row of equal tiles:
 * on `lg` the five columns fill as 1 + 2 + 2 across two rows, with the location
 * card taking both rows of the right-hand pair. Add a card by giving a
 * `PlaceholderCard` slot a real one — keep the spans adding up to five.
 */
export default function BentoGrid({
  site,
  coordinates,
  latitude,
  longitude,
}: BentoGridProps) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
      <MachineCountCard
        count={site.machineCount}
        className="col-span-1 min-h-40"
      />
      <GeneralCard
        coordinates={coordinates}
        updatedAt={site.updatedAt}
        id={site.id}
        className="min-h-40 lg:col-span-2"
      />
      <LocationCard
        name={site.name}
        address={addressLines(site)}
        latitude={latitude}
        longitude={longitude}
        className="col-span-2 row-span-2 min-h-40"
      />
      <ContactsCard
        contactName={site.contactName}
        contactEmail={site.contactEmail}
        contactPhone={site.contactPhone}
        className="min-h-40 lg:col-span-2"
      />
      <PlaceholderCard className="col-span-1 min-h-40" />
    </div>
  )
}
