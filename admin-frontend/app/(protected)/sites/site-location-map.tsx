"use client"

import { ReactElement, useEffect, useState } from "react"

import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  type MapViewport,
} from "@/components/ui/map"
import { cn } from "cn"

/** Close enough to read street names, which is the point of the preview. */
const LOCATION_ZOOM = 15

type SiteLocationMapProps = {
  latitude: number
  longitude: number
  /** Drawn above the pin. Usually the site's name or the matched address. */
  label?: string | ReactElement
  /** Overrides the default height — the wrapper is what gives the map a size. */
  className?: string
}

/**
 * A single pin on a basemap, centred on the coordinates it is given.
 *
 * The viewport is controlled rather than passed as `center` / `zoom`: `Map`
 * reads those once, when it constructs the MapLibre instance, so a second
 * address picked in the same dialog would leave the map sitting on the first
 * one. Panning writes straight back into the same state, so whatever view the
 * user scrolled to survives until the coordinates themselves change.
 */
export function SiteLocationMap({
  latitude,
  longitude,
  label,
  className,
}: SiteLocationMapProps) {
  const [viewport, setViewport] = useState<MapViewport>({
    center: [longitude, latitude],
    zoom: LOCATION_ZOOM,
    bearing: 0,
    pitch: 0,
  })

  useEffect(() => {
    setViewport((current) =>
      current.center[0] === longitude && current.center[1] === latitude
        ? current
        : { ...current, center: [longitude, latitude], zoom: LOCATION_ZOOM }
    )
  }, [latitude, longitude])

  return (
    <div
      className={cn(
        "h-56 w-full overflow-hidden rounded-md border bg-muted",
        className
      )}
    >
      <Map viewport={viewport} onViewportChange={setViewport}>
        <MapControls />
        <MapMarker longitude={longitude} latitude={latitude}>
          <MarkerContent>
            <div className="size-3.5 rounded-full border-2 border-white bg-primary shadow-lg" />
            {label && (
              <MarkerLabel className="rounded bg-background/90 px-1 py-0.5 shadow-sm">
                {label}
              </MarkerLabel>
            )}
          </MarkerContent>
        </MapMarker>
      </Map>
    </div>
  )
}
