import Link from "next/link"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { getAlertsSummary } from "@/lib/data/alerts"
import { requireAccess } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import { RoleGate } from "@/components/role-gate"
import { AlertRow } from "./alert-row"
import { ResolveAlertButton } from "./resolve-alert-button"
import { SectionError } from "./section-error"
import { ShowMoreList } from "./show-more-list"

const TYPE_LABELS: Record<string, string> = {
  tamper: "Tamper",
  offline: "Offline",
  error: "Error",
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * The alerts still open and unhandled, newest first. How many there are is the
 * KPI row's job; this is the queue itself.
 *
 * hasPermission rather than requirePermission — this is one section of a page
 * built for two roles, and a redirect would take the sales figures away from an
 * owner whose only missing permission is alerts.
 */
export async function NeedsAttentionSection() {
  const session = await requireAccess()
  if (!hasPermission(session, PERMISSIONS.ALERT_READ)) return null

  const [error, summary] = await getAlertsSummary()

  return (
    <section>
      <h2 className="text-lg font-semibold">Needs attention</h2>
      {error ? (
        <SectionError message="Couldn't load alerts." />
      ) : summary.openTotal === 0 ? (
        // The good case, worded as reassurance rather than left as an
        // empty card that reads like a widget that failed to load.
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing needs attention right now.
        </p>
      ) : (
        <ShowMoreList className="mt-4 divide-y rounded-md border">
          {summary.recent.map((alert) => (
            <AlertRow key={alert.id}>
              <Link
                href={`/machines/alerts`}
                className="min-w-0 flex-1 hover:underline"
              >
                <span className="font-medium">{TYPE_LABELS[alert.type]}</span> ·{" "}
                {alert.machineName} · {alert.siteName}
                <span className="block text-muted-foreground">
                  {alert.message}
                </span>
              </Link>
              <span className="text-muted-foreground">
                {timeAgo(alert.occurredAt)}
              </span>
              {/* performRedirect={false}: an operator who can read alerts
                      but not close them should lose the button, not the whole
                      page. */}
              <RoleGate
                perms={[PERMISSIONS.ALERT_RESOLVE]}
                performRedirect={false}
              >
                <ResolveAlertButton alertId={alert.id} />
              </RoleGate>
            </AlertRow>
          ))}
        </ShowMoreList>
      )}
    </section>
  )
}
