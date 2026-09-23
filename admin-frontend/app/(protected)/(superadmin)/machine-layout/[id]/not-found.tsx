import Link from "next/link"
import { ServerCrash } from "lucide-react"

import { Button } from "@/components/ui/button"

/** The loader serves claimed and unclaimed machines alike, so reaching this
 *  page means the id matched no machine at all — not that it was claimed. */
export default function MachineLayoutNotFound() {
  return (
    <div className="container mx-auto flex flex-col items-center gap-4 py-20 text-center">
      <ServerCrash className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Machine not found</h1>
        <p className="text-muted-foreground">
          No machine matches this id. It may have been deleted.
        </p>
      </div>
      <Button render={<Link href="/create-machine">Back to machines</Link>} />
    </div>
  )
}
