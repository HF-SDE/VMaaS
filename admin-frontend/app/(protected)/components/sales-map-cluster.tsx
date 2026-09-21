"use client"

import { useMemo, useState } from "react"
import type * as GeoJSON from "geojson"

import {
  Map,
  MapClusterLayer,
  MapControls,
  MapPopup,
} from "@/components/ui/map"
import { cn, formatDateTime, formatPrice } from "@/lib/utils"
import type { SaleMapPoint } from "@vmaas/shared/types/sale"

/**
 * Keeps sales clustered at every zoom level. Sales made at the same site share
 * one coordinate exactly, so letting clustering switch off would drop five
 * sales as five dots stacked on the same pixel — indistinguishable from one,
 * and with no total on them. Clustered, they stay one circle reading "5".
 */
const CLUSTER_MAX_ZOOM = 20

/** Fewer sales than a whole country's worth, so the default 100/750 steps would
 *  paint almost every cluster the same colour. */
const CLUSTER_THRESHOLDS: [number, number] = [10, 50]

/** Fits the bounds loosely enough that edge points aren't under the controls. */
const FIT_PADDING = 48

/** What travels with each point, and what the popup reads back out. */
type SalePointProperties = {
  id: string
  price: number
  productName: string | null
  machineName: string
  siteName: string
  createdAt: string
}

type SalesMapClusterProps = {
  /** Every sale to plot. One point per sale — see `CLUSTER_MAX_ZOOM`. */
  sales: SaleMapPoint[]
  /** Overrides the default height. The wrapper is what gives the map a size. */
  className?: string
}

type SelectedSale = {
  longitude: number
  latitude: number
  properties: SalePointProperties
}

function toFeatureCollection(
  sales: SaleMapPoint[]
): GeoJSON.FeatureCollection<GeoJSON.Point, SalePointProperties> {
  return {
    type: "FeatureCollection",
    features: sales.map((sale) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [sale.longitude, sale.latitude] },
      properties: {
        id: sale.id,
        price: sale.price,
        productName: sale.productName,
        machineName: sale.machineName,
        siteName: sale.siteName,
        createdAt: sale.createdAt,
      },
    })),
  }
}

/** The smallest box containing every sale, as MapLibre's `[[w,s],[e,n]]`. */
function boundsOf(
  sales: SaleMapPoint[]
): [[number, number], [number, number]] | undefined {
  if (sales.length === 0) return undefined

  const lngs = sales.map((sale) => sale.longitude)
  const lats = sales.map((sale) => sale.latitude)

  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

/**
 * Sales plotted where they were rung up, clustered by proximity.
 *
 * Each cluster is labelled with how many sales it holds and what they earned:
 * MapLibre sums the `price` of every point it swallowed through
 * `clusterProperties`, so the total is recomputed by the map itself as you zoom
 * rather than being pre-aggregated per site. A sale that ends up alone stays a
 * single dot, and clicking it opens its details.
 *
 * The data is a prop, never fetched here — the caller owns the request, its
 * permission check and its cache tier.
 */
export function SalesMapCluster({ sales, className }: SalesMapClusterProps) {
  const [selected, setSelected] = useState<SelectedSale | null>(null)

  const data = useMemo(() => toFeatureCollection(sales), [sales])
  const bounds = useMemo(() => boundsOf(sales), [sales])

  if (sales.length === 0) {
    return (
      <div
        className={cn(
          "flex h-96 w-full items-center justify-center rounded-md border bg-muted",
          className
        )}
      >
        <p className="text-sm text-muted-foreground">
          No sales to show on the map yet.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "h-96 w-full overflow-hidden rounded-md border bg-muted",
        className
      )}
    >
      <Map
        bounds={bounds}
        fitBoundsOptions={{ padding: FIT_PADDING, maxZoom: 14 }}
      >
        <MapControls />
        <MapClusterLayer<SalePointProperties>
          data={data}
          clusterMaxZoom={CLUSTER_MAX_ZOOM}
          clusterThresholds={CLUSTER_THRESHOLDS}
          clusterProperties={{ revenue: ["+", ["get", "price"]] }}
          clusterLabel={[
            "format",
            ["get", "point_count_abbreviated"],
            {},
            "\n",
            {},
            // Whole kroner only: the label has to fit inside a 40px circle, and
            // the exact amount is one zoom away.
            [
              "number-format",
              ["get", "revenue"],
              {
                locale: "da-DK",
                currency: "DKK",
                "max-fraction-digits": 0,
              },
            ],
            { "font-scale": 0.8 },
          ]}
          onPointClick={(feature, coordinates) =>
            setSelected({
              longitude: coordinates[0],
              latitude: coordinates[1],
              properties: feature.properties as SalePointProperties,
            })
          }
        />
        {selected && (
          <MapPopup
            longitude={selected.longitude}
            latitude={selected.latitude}
            closeButton
            onClose={() => setSelected(null)}
          >
            <div className="space-y-0.5 text-xs">
              <p className="text-sm font-medium">
                {selected.properties.productName ?? "Deleted product"}
              </p>
              <p className="tabular-nums">
                {formatPrice(selected.properties.price)}
              </p>
              <p className="text-muted-foreground">
                {selected.properties.machineName} ·{" "}
                {selected.properties.siteName}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {formatDateTime(selected.properties.createdAt)}
              </p>
            </div>
          </MapPopup>
        )}
      </Map>
    </div>
  )
}
