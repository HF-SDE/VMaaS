"use client"

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { cn, formatDateTime } from "@/lib/utils"
import type { MachineAlertRow } from "@vmaas/shared/types/machineAlert"

import { alertTypeLabels, alertTypeStyles } from "./alert-types"

/** One labelled value in the expanded panel. */
function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-mono wrap-break-word text-foreground">{children}</p>
    </div>
  )
}

export function AlertRow({ alert }: { alert: MachineAlertRow }) {
  const resolved = alert.resolvedAt !== null

  return (
    <AccordionItem value={alert.id} className="border-b last:border-b-0">
      <AccordionTrigger className="px-3 py-3 hover:bg-muted/50 hover:no-underline sm:px-4">
        {/* Mobile: stacked. The grid below takes over at md. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {alert.machineName}
            </span>
            <Badge
              variant="secondary"
              className={cn("shrink-0", alertTypeStyles[alert.type])}
            >
              {alertTypeLabels[alert.type]}
            </Badge>
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {alert.message}
          </span>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <time className="font-mono text-[11px]">
              {formatDateTime(alert.occurredAt)}
            </time>
            <span aria-hidden="true" className="text-[10px]">
              •
            </span>
            <span className="min-w-0 truncate">{alert.siteName}</span>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 items-center gap-4 md:grid md:grid-cols-[7rem_10rem_minmax(0,1fr)_minmax(0,1fr)_5rem]">
          <Badge
            variant="secondary"
            className={cn("w-fit", alertTypeStyles[alert.type])}
          >
            {alertTypeLabels[alert.type]}
          </Badge>

          <time className="font-mono text-xs text-muted-foreground">
            {formatDateTime(alert.occurredAt)}
          </time>

          <span className="truncate text-sm font-medium text-foreground">
            {alert.machineName}
          </span>

          <span className="truncate text-sm text-muted-foreground">
            {alert.siteName}
          </span>

          <span
            className={cn(
              "justify-self-end text-xs font-medium",
              resolved
                ? "text-muted-foreground"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {resolved ? "Resolved" : "Open"}
          </span>
        </div>
      </AccordionTrigger>

      <AccordionContent className="bg-muted/50 px-4">
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Message
            </p>
            <p className="rounded bg-background p-3 font-mono text-sm text-foreground">
              {alert.message}
            </p>
          </div>

          <div className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Machine">{alert.machineName}</Detail>
            <Detail label="Site">{alert.siteName}</Detail>
            <Detail label="Status">{resolved ? "Resolved" : "Open"}</Detail>
            <Detail label="Occurred at">
              {formatDateTime(alert.occurredAt)}
            </Detail>
            <Detail label="Reported at">
              {formatDateTime(alert.createdAt)}
            </Detail>
            <Detail label="Resolved at">
              {alert.resolvedAt ? formatDateTime(alert.resolvedAt) : "—"}
            </Detail>
            <Detail label="Contact phone">{alert.contactPhone ?? "—"}</Detail>
            <Detail label="Contact email">{alert.contactEmail ?? "—"}</Detail>
            <Detail label="Alert ID">{alert.id}</Detail>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
