import Link from "next/link"
import { MapPinOff } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Also what a site belonging to another tenant renders — the backend answers
 *  404 there rather than revealing that the id exists. */
export default function SiteNotFound() {
  return (
    <div className="container mx-auto flex flex-col items-center gap-4 py-20 text-center">
      <MapPinOff className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Site not found</h1>
        <p className="text-muted-foreground">
          It has either been deleted, or it belongs to another organization.
        </p>
      </div>
      <Button render={<Link href="/sites">Back to sites</Link>} />
    </div>
  )
}
