"use client"

import * as React from "react"
import { ExternalLink, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getInvoicesPage } from "@/lib/data/invoices"
import type { TenantInvoice } from "@vmaas/shared/types/invoice"

/** Stripe reports `created` in seconds, not milliseconds. */
function formatDate(created: number): string {
  return new Date(created * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  })
}

/**
 * The tenant's receipts, paged by cursor.
 *
 * Loaded in the browser rather than on the server: the list is behind a tab
 * most visits never open, and asking Stripe for it on every render of the
 * account page would make the page wait on a third party for something nobody
 * looked at. Nothing is stored here — every row links back to Stripe, which is
 * the record of what was actually billed.
 */
export function InvoicesCard() {
  const [invoices, setInvoices] = React.useState<TenantInvoice[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async (startingAfter?: string) => {
    setLoading(true)
    setError(null)

    const [failure, page] = await getInvoicesPage({ startingAfter })

    if (failure) {
      setError(
        failure.status === 403
          ? "Only an owner can view the billing history for this organization."
          : "Could not load your invoices. Please try again."
      )
      setLoading(false)
      return
    }

    // A cursor means "load more", so the page is appended; without one this is
    // the first load and replaces whatever was there.
    setInvoices((current) =>
      startingAfter ? [...current, ...page.data] : page.data
    )
    setCursor(page.nextCursor)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          View and download your invoices. Keep track of your billing history
          and payment status.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : (
          <Table>
            <TableCaption>
              {loading && invoices.length === 0
                ? "Loading your invoices…"
                : invoices.length === 0
                  ? "You have no invoices yet."
                  : "A list of your paid invoices."}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Date</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const link = invoice.hostedUrl ?? invoice.pdfUrl

                return (
                  <TableRow key={invoice.id}>
                    <TableCell>{formatDate(invoice.created)}</TableCell>
                    <TableCell className="font-medium">
                      {invoice.number ?? invoice.id}
                    </TableCell>
                    <TableCell className="text-right">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline underline-offset-4"
                        >
                          View
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Stripe reports no total, so there is no page number to offer — only
          whether another page exists. */}
      {!error && cursor && (
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => load(cursor)}
            disabled={loading}
          >
            {loading && <Loader2 className="animate-spin" />}
            Load more
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
