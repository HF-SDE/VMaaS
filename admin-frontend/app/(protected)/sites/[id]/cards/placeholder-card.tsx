import { Card, CardContent } from "@/components/ui/card"

/** An empty slot in the grid, holding its shape until there is something worth
 *  showing in it. Duplicate it for every slot you want to reserve. */
export function PlaceholderCard({
  label = "More coming soon",
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <Card className={className}>
      <CardContent className="flex-1 items-center justify-center">
        <p className="text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
