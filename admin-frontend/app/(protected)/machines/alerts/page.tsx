import { Suspense } from "react"
import Link from "next/link"
import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { Button } from "@/components/ui/button"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { MachineAlertLogs } from "./components/machine-alert-logs"
import { SessionProvider } from "@/lib/session-provider"
import { getSession } from "@/lib/dal"

/**
 * The gate here is UI only. `MachineAlertLogs` fetches from the browser, so
 * there is no server data loader to guard with `requirePermission` — the
 * endpoint re-checks `alert:read` and tenant membership on every request.
 */
export default async function AlertLogsPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex w-full justify-between">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Machine alerts</h1>
          <p className="text-muted-foreground">
            Every alert reported by your machines.
          </p>
        </div>
        <Suspense fallback={<Loader />}>
          <RoleGate perms={[PERMISSIONS.MACHINE_READ]}>
            <Button
              nativeButton={false}
              render={<Link href="/machines">Go to machines</Link>}
              size="lg"
            />
          </RoleGate>
        </Suspense>
      </div>
      <Suspense fallback={<Loader />}>
        <ProvideSession>
          <MachineAlertLogs />
        </ProvideSession>
      </Suspense>
    </div>
  )
}

async function ProvideSession({ children }: { children: React.ReactNode }) {
  const session = await getSession(true)

  return (
    <Suspense fallback={<Loader />}>
      <RoleGate perms={[PERMISSIONS.ALERT_READ]}>
        <SessionProvider session={session}>{children}</SessionProvider>
      </RoleGate>
    </Suspense>
  )
}
