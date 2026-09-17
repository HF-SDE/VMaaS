import Link from "next/link"
import { ServerCrash } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Also what a machine that has been given to a tenant renders; its layout isn't edited from here */
export default function MachineLayoutNotFound() {
  return (
    <div className="container mx-auto flex flex-col items-center gap-4 py-20 text-center">
      <ServerCrash className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Machine not found</h1>
        <p className="text-muted-foreground">
          It has either been deleted, or it has already been given to a tenant.
        </p>
      </div>
      <Button render={<Link href="/create-machine">Back to machines</Link>} />
    </div>
  )
}
