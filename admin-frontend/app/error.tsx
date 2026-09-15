"use client"

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

/**
 * The boundary the server-side gates throw into. `lib/session-fetch.ts` and the
 * `lib/data/*` readers deliberately throw on a backend failure rather than
 * reporting "signed out", which only works if something catches the throw —
 * without this file it unwinds past the root and takes the whole page down.
 *
 * It sits at the app root, above `(protected)/layout.tsx`, because a failed
 * session lookup means the sidebar cannot render either. A denial the user is
 * allowed to recover from belongs on /forbidden instead; this is for the cases
 * where the answer is "the backend did not respond".
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Unhandled error rendering the page:", error)
  }, [error])

  return (
    <div className="container mx-auto flex py-10">
      <Empty className="mx-auto max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>
            We could not load this page. The service may be briefly unavailable —
            trying again often resolves it.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>
              <RefreshCwIcon />
              Try again
            </Button>
            <Button variant="outline" render={<Link href="/" />}>
              Back to overview
            </Button>
          </div>

          {/* The digest is the only handle on the server-side log for this
              throw, so it has to be visible for a user to be able to report it. */}
          {error.digest ? (
            <p className="text-muted-foreground mt-4 font-mono text-xs">
              Reference: {error.digest}
            </p>
          ) : null}
        </EmptyContent>
      </Empty>
    </div>
  )
}
