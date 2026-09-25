import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** How many machines stand here. Zero is the only count that makes the site
 *  deletable, so it is worth a card of its own. */
export function MachineCountCard({
  count,
  className,
}: {
  count: number
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Machines</CardTitle>
      </CardHeader>
      <CardContent className="justify-center">
        <p className="text-4xl font-semibold tabular-nums">{count}</p>
        <p className="text-muted-foreground">
          {count === 1 ? "machine at this site" : "machines at this site"}
        </p>
      </CardContent>
    </Card>
  )
}
