"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Loader2, RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { fetchData } from "@/lib/data/data-fetch"
import { ClaimResult } from "@/types/responses"

import { claimErrorMessage, formatSetupCode, timeLeftLabel } from "./claim"
import { ClaimFormValues } from "./claim-form"

/**
 * The one-time code, shown once.
 *
 * Only the code's argon2 hash is stored, so this panel is the only place it
 * ever exists. Closing the dialog loses it — the way back is a new claim, which
 * is what "New code" does.
 */
export function SetupCodePanel({
  result,
  claimed,
  onDone,
}: {
  result: ClaimResult
  /** What was claimed, so a new code can be asked for without retyping it. */
  claimed: ClaimFormValues
  onDone: () => void
}) {
  const router = useRouter()
  const [current, setCurrent] = useState(result)
  const [copied, setCopied] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [now, setNow] = useState(() => new Date())

  // One second is the smallest unit the label shows, so nothing finer is worth
  // re-rendering for.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Reverting the tick is what makes the button say "Copy" again; without it a
  // second copy looks like nothing happened.
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const left = timeLeftLabel(current.expiresAt, now)
  const expired = left === "Expired"

  async function copy() {
    try {
      await navigator.clipboard.writeText(current.oneTimeCode)
      setCopied(true)
    } catch {
      // A denied clipboard permission, or an insecure origin. The code is on
      // screen either way, so this is worth a word but not an error state.
      toast.error("Could not copy. Read the code off the screen instead.")
    }
  }

  async function renew() {
    setRenewing(true)
    const [error, next] = await fetchData<ClaimResult>("/api/machines/claim", {
      method: "POST",
      body: { serialNumber: claimed.serialNumber, siteId: claimed.siteId },
    })
    setRenewing(false)

    if (error) {
      toast.error(claimErrorMessage(error.status))
      return
    }

    // Claiming again expires the previous code server-side, so the panel must
    // show the new one or it would be offering a code that no longer works.
    setCurrent(next)
    setCopied(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-muted/40 p-4 text-center">
        <p
          className="font-mono text-2xl font-semibold tracking-widest break-all"
          aria-label={`Setup code ${current.oneTimeCode.split("").join(" ")}`}
        >
          {formatSetupCode(current.oneTimeCode)}
        </p>
        <p
          className={
            expired
              ? "mt-2 text-sm text-destructive"
              : "mt-2 text-sm text-muted-foreground"
          }
          role={expired ? "alert" : undefined}
        >
          {expired ? "This code has expired." : `Expires in ${left}`}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Type this on the machine&apos;s keypad. It is shown once — close this and
        the only way back is a new code.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={renew} disabled={renewing}>
          {renewing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          New code
        </Button>
        <Button type="button" variant="outline" onClick={copy} disabled={expired}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          onClick={() => {
            onDone()
            // The machine now belongs to this tenant, so the list behind the
            // dialog is out of date.
            router.refresh()
          }}
        >
          Done
        </Button>
      </div>
    </div>
  )
}
