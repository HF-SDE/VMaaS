import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { NO_READ_ACCESS, MachineDetailLoader } from "./machine-detail"

/**
 * A single machine.
 *
 * Everything below the back link depends on the session and on the machine, so
 * the static shell is the link alone — the rest streams in behind <Suspense>.
 * The guard sits on the page rather than on the protected layout, which reads
 * no session on purpose.
 */
export default async function MachinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <div className="container mx-auto py-10">
      <Link
        href="/machines"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to machines
      </Link>

      <Suspense fallback={<Loader text="Loading machine..." />}>
        <RoleGate perms={[PERMISSIONS.MACHINE_READ]} reason={NO_READ_ACCESS}>
          <MachineDetailLoader params={params} />
        </RoleGate>
      </Suspense>
    </div>
  )
}
