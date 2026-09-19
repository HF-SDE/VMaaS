"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

type RowResolve = { collapse: () => void; restore: () => void }

const RowResolveContext = createContext<RowResolve | null>(null)

/**
 * What a row hands its resolve button: collapse me now, or put me back.
 *
 * A context rather than a prop because the button is rendered further down a
 * server-rendered tree (through <RoleGate>), and a server component cannot
 * pass a function to a client one.
 */
export function useRowResolve(): RowResolve | null {
  return useContext(RowResolveContext)
}

/**
 * One alert in the "needs attention" list, able to animate itself away.
 *
 * The row collapses *before* the server action runs rather than after: the
 * action's refresh() is part of the same transition, so by the time it
 * resolves the refreshed list has already replaced this row and there is
 * nothing left to animate. Collapsing optimistically means the rows below
 * slide up while the request is in flight, and `restore` puts the row back if
 * it turns out the alert was not resolved after all.
 *
 * The height animation is the 1fr → 0fr grid trick: `height: auto` is not
 * interpolable, a grid track is.
 */
export function AlertRow({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <RowResolveContext
      value={{
        collapse: () => setCollapsed(true),
        restore: () => setCollapsed(false),
      }}
    >
      <li
        className={cn(
          "grid grid-rows-[1fr] transition-all duration-300 ease-out motion-reduce:transition-none",
          // border-transparent as well as the zero height: divide-y put a
          // border on this row, and a 1px line hanging under the row above is
          // exactly the leftover the animation is meant to clear away.
          collapsed && "grid-rows-[0fr] border-transparent opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 p-3 text-sm">
            {children}
          </div>
        </div>
      </li>
    </RowResolveContext>
  )
}
