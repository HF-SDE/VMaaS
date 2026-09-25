"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"
import "./globals.css"

/**
 * The last resort: `app/error.tsx` sits inside the root layout, so it cannot
 * catch a throw from the root layout itself. This one replaces the whole
 * document, which is why it renders its own <html>/<body> and leans on plain
 * elements — the providers and fonts it would normally inherit are exactly
 * what may have failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The application failed to load. Please try again.
          </p>

          <button
            onClick={reset}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>

          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
