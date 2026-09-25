"use client"

import dynamic from "next/dynamic"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/** MapLibre is a large dependency and only this one card needs it — loading it
 *  on demand keeps it out of the page's initial bundle. `ssr: false` because
 *  the map reads `window`, which is also why this file is a client component. */
const SiteLocationMap = dynamic(
  () => import("../../site-location-map").then((m) => m.SiteLocationMap),
  { ssr: false, loading: () => <Skeleton className="min-h-56 flex-1" /> }
)

type LocationCardProps = {
  /** Drawn above the pin. */
  name: string
  /** The address as it would be written on an envelope, blanks already dropped. */
  address: string[]
  /** Both or neither — half a pair locates nothing. */
  latitude: number | null
  longitude: number | null
  className?: string
}

/** The site on a basemap, with its postal address underneath. The widest tile
 *  in the grid: the map is the one thing here that needs the room. */
export function LocationCard({
  name,
  address,
  latitude,
  longitude,
  className,
}: LocationCardProps) {
  const hasPin = latitude !== null && longitude !== null

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Location</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {hasPin ? (
          <SiteLocationMap
            latitude={latitude}
            longitude={longitude}
            label={name}
            className="h-auto min-h-56 flex-1"
            disableControls={true}
          />
        ) : (
          <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-dashed">
            <p className="text-muted-foreground">No pin for this site yet.</p>
          </div>
        )}

        {address.length > 0 ? (
          <address className="leading-relaxed not-italic">
            {address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          <p className="text-muted-foreground">No address on file.</p>
        )}
      </CardContent>
    </Card>
  )
}
