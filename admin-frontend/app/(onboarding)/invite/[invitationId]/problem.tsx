import Link from "next/link"
import { AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/** Every way an invitation can be unusable, rendered the same way: say what
 *  happened, then offer the one thing the user can still do. */
export function InviteProblem({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
          <AlertCircle className="size-5 text-muted-foreground" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardFooter className="flex-col items-stretch gap-2">
        {action}
        <Button variant="outline" render={<Link href="/" />}>
          Continue to VMaaS
        </Button>
      </CardFooter>
    </Card>
  )
}
