import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { NO_READ_ACCESS, SiteDetailLoader } from "./site-detail"

/**
 * A single site.
 *
 * Everything below the back link depends on the session and on the site, so the
 * static shell is the link alone — the rest streams in behind <Suspense>. The
 * title row belongs to the loader for the same reason: it names the site, so it
 * cannot render before the site is read. The guard sits on the page rather than
 * on the protected layout, which reads no session on purpose.
 */
export default async function SitePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <div className="container mx-auto py-10">
      <Link
        href="/sites"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sites
      </Link>

      <Suspense fallback={<Loader text="Loading site..." />}>
        <RoleGate perms={[PERMISSIONS.SITE_READ]} reason={NO_READ_ACCESS}>
          <SiteDetailLoader params={params} />
        </RoleGate>
      </Suspense>
    </div>
  )
}
