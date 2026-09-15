import Link from "next/link"
import { ServerCrash } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Also what a machine belonging to another tenant renders — the backend
 *  answers 404 there rather than revealing that the id exists. */
export default function MachineNotFound() {
  return (
    <div className="container mx-auto flex flex-col items-center gap-4 py-20 text-center">
      <ServerCrash className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Machine not found</h1>
        <p className="text-muted-foreground">
          It has either been deleted, or it belongs to another organization.
        </p>
      </div>
      <Button render={<Link href="/machines">Back to machines</Link>} />
    </div>
  )
}
