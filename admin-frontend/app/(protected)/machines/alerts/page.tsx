import { Suspense } from "react"
import Link from "next/link"
import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { Button } from "@/components/ui/button"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { MachineAlertLogs } from "./components/machine-alert-logs"
import { SessionProvider } from "@/lib/session-provider"
import { requirePermission } from "@/lib/dal"

/**
 * `MachineAlertLogs` fetches from the browser, so `ProvideSession` is the
 * page's gate — the endpoint still re-checks `alert:read`, tenant membership
 * and the subscription on every request.
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
  // requirePermission, not getSession: it also enforces the onboarding and
  // billing gates, so a locked organization is sent to /billing/locked.
  const session = await requirePermission(PERMISSIONS.ALERT_READ)

  return <SessionProvider session={session}>{children}</SessionProvider>
}
