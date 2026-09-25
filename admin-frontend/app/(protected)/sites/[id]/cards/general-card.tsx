import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/utils"

import { DetailRow } from "./detail-row"

type GeneralCardProps = {
  /** Already formatted for display — the page holds the `Decimal` pair. */
  coordinates: string | null
  updatedAt: Date | string
  id: string
  className?: string
}

/** The site's own record: when it last changed, where its pin sits, and the id
 *  support will ask for. */
export function GeneralCard({
  coordinates,
  updatedAt,
  id,
  className,
}: GeneralCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <DetailRow label="Last updated" value={formatDate(updatedAt)} />
          <DetailRow label="Coordinates" value={coordinates} />
          <DetailRow
            label="ID"
            value={<span className="font-mono text-xs">{id}</span>}
            className="sm:col-span-2"
          />
        </dl>
      </CardContent>
    </Card>
  )
}
