"use client"

import { useEffect, useState } from "react"
import { Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { fetchData } from "@/lib/data/data-fetch"

import { configurationHistoryErrorMessage, publishErrorMessage } from "../messages"

interface ConfigurationVersion {
  version: number
  createdAt: string
  createdBy: { name: string } | null
}

/**
 * `null` means nothing has ever been published — a different state from
 * `{ wiring: false, prices: false }`, which means the newest published
 * version still matches what's stored. Only the latter is "in step"; the
 * two must not be collapsed into one another.
 */
interface ConfigurationDrift {
  wiring: boolean
  prices: boolean
}

interface ConfigurationListResult {
  versions: ConfigurationVersion[]
  drift: ConfigurationDrift | null
}

interface PublishResult {
  version: number
  /**
   * `null` when the machine has no tenant yet: this editor serves both
   * claimed and unclaimed machines (see `getMachineForLayoutService`), but a
   * machine command needs a tenant. The configuration is still stored and
   * versioned either way; delivering it to the machine additionally needs a
   * device-side fetch on boot, which is not built yet (a future firmware
   * plan), so an unclaimed machine does not receive it automatically.
   */
  commandId: string | null
}

interface PublishPanelProps {
  machineId: string
  /**
   * Publishing builds the configuration from the machine's *stored* rows, not
   * from whatever is currently on screen. While the editor has unsaved
   * changes those two disagree, so publishing has to be blocked until the
   * layout is saved — otherwise "Published version N" would describe wiring
   * that was never actually saved.
   */
  layoutIsDirty: boolean
  /**
   * Bumped by the editor once per successful save (not per keystroke). Drift
   * is measured against stored rows, so a save is the only edit-side event
   * that can change it — without this, the banner is a snapshot of page-load
   * state and never learns that a saved change now differs from what's
   * published.
   */
  savedRevision: number
}

/**
 * Publishing is a separate act from saving the layout: a wrong pin dispenses the
 * wrong product to someone who has already paid, so the wiring gets a review
 * step, and the history stays one row per deliberate change.
 */
export function PublishPanel({ machineId, layoutIsDirty, savedRevision }: PublishPanelProps) {
  const [versions, setVersions] = useState<ConfigurationVersion[]>([])
  const [drift, setDrift] = useState<ConfigurationDrift | null>(null)
  const [historyError, setHistoryError] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadVersions() {
    const [error, rows] = await fetchData<ConfigurationListResult>(
      `/api/machines/${machineId}/configurations`
    )
    if (error) {
      setHistoryError(error.status)
      return
    }
    setHistoryError(null)
    setVersions(rows.versions)
    setDrift(rows.drift)
  }

  // savedRevision has no value of its own; it only exists to make this effect
  // rerun once per successful save, alongside the mount/machine-change refetch.
  useEffect(() => {
    loadVersions()
  }, [machineId, savedRevision])

  async function publish(fromVersion?: number) {
    setBusy(true)

    const [error, result] = await fetchData<PublishResult>(
      `/api/machines/${machineId}/publish-configuration`,
      { method: "POST", body: fromVersion === undefined ? {} : { fromVersion } }
    )

    setBusy(false)

    if (error) {
      toast.error("The configuration was not published", {
        description: publishErrorMessage(error.status),
      })
      return
    }

    if (result.commandId) {
      toast.success(`Published version ${result.version}`, {
        description: "Stored as the new version, and a command was published on the machine's MQTT topic. The device doesn't yet fetch or apply it.",
      })
    } else {
      toast.success(`Version ${result.version} stored`, {
        description: "This machine has no tenant yet, so nothing was sent. The wiring is saved as this version; delivering it to the machine needs a device-side fetch that isn't built yet.",
      })
    }

    loadVersions()
  }

  return (
    <section className="mt-6 space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Saving the layout stores it. Publishing reviews it as the next
            deliberate version and, for a claimed machine, publishes a command
            on its MQTT topic. The device doesn&apos;t fetch or apply
            configuration yet, so nothing changes on the machine itself until
            that&apos;s built.
          </p>
        </div>
        <Button onClick={() => publish()} disabled={busy || layoutIsDirty}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload className="h-4 w-4" />}
          Publish
        </Button>
      </div>

      {layoutIsDirty && (
        <p className="text-xs text-muted-foreground">
          Save the layout before publishing — publishing now would publish the
          last saved wiring, not these unsaved changes.
        </p>
      )}

      {drift && (drift.wiring || drift.prices) && (
        <p className="text-sm text-destructive">
          {drift.wiring && drift.prices
            ? `The wiring and the prices have changed since v${versions[0]?.version}.`
            : drift.wiring
              ? `The wiring or motor settings have changed since v${versions[0]?.version}.`
              : `The prices have changed since v${versions[0]?.version}.`}{" "}
          Publish to record a new version.
        </p>
      )}

      {historyError !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {configurationHistoryErrorMessage(historyError)}
        </p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing published yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {versions.map((entry, index) => (
            <li key={entry.version} className="flex items-center justify-between py-2">
              <span>
                v{entry.version}
                <span className="ml-2 text-muted-foreground">
                  {entry.createdBy?.name ?? "Unknown"} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </span>
              {index > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => publish(entry.version)}
                >
                  Roll back to v{entry.version}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
