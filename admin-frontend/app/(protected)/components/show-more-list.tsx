"use client"

import { Children, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

/**
 * A list that shows its first `max` items and hides the rest behind a button.
 *
 * The items stay server-rendered and are passed straight through as children —
 * only the expanded/collapsed decision lives on the client.
 */
export function ShowMoreList({
  children,
  max = 5,
  className,
}: {
  children: ReactNode
  max?: number
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const items = Children.toArray(children)
  const hidden = items.length - max

  return (
    <>
      <ul className={className}>{expanded ? items : items.slice(0, max)}</ul>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </Button>
      )}
    </>
  )
}
