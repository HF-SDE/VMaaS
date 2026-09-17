import * as React from "react"
import { cn } from "@/lib/utils"

export interface VendingMachineProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  label?: string
  status?: string
  /** Classes for the content inside the display window. */
  windowClassName?: string
  /** Optional real controls to replace the decorative keypad and coin slot. */
  controls?: React.ReactNode
}

/**
 * A presentational vending-machine shell using standard shadcn theme tokens.
 * Children remain interactive and the window grows to fit its content.
 * Requires the usual shadcn `cn` utility at @/lib/utils.
 */
export function VendingMachineSlim({
  children,
  label = "Ur mom machine",
  status = "Ready",
  className,
  windowClassName,
  controls = <DecorativeControls />,
  ...props
}: VendingMachineProps) {
  return (
    <div className={cn("relative w-full max-w-xl pb-3", className)} {...props}>
      <div className="relative z-10 rounded-3xl border border-border bg-card p-4 text-card-foreground shadow-lg">
        {/* Illuminated nameplate */}
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3">
          <span className="min-w-0 text-sm font-semibold tracking-[0.25em] break-words uppercase">
            {label}
          </span>
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgb(16_185_129/0.3)]"
          />
        </div>

        <div className="flex flex-col gap-3">
          {/* No fixed height or clipping: children own their layout. */}
          <div className="relative min-w-0 rounded-2xl bg-zinc-900 p-1.5 shadow-inner dark:bg-zinc-950">
            {/* A grid rather than a block so children stretch to the whole
                window when they can, and overflow into the scroll when they
                cannot. */}
            <div
              className={cn(
                "relative grid min-h-80 min-w-0 overflow-auto rounded-[10px] bg-background p-4 text-foreground",
                windowClassName
              )}
            >
              {children}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-1.5 rounded-[10px] border border-white/10 shadow-[inset_2px_2px_0_rgb(255_255_255/0.08)]"
            />
          </div>

          {/* Pickup tray and ventilation are decorative. */}
          <div aria-hidden="true" className="rounded-xl bg-zinc-950 p-1.5">
            <div className="flex h-14 items-center justify-center rounded-md border-t-4 border-zinc-600 bg-zinc-800 shadow-inner">
              <span className="text-[10px] font-medium tracking-[0.3em] text-zinc-400 uppercase">
                Push
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-x-7 bottom-0 flex justify-between"
      >
        <div className="h-4 w-10 rounded-b-md bg-zinc-900" />
        <div className="h-4 w-10 rounded-b-md bg-zinc-900" />
      </div>
    </div>
  )
}

function DecorativeControls() {
  return (
    // These are decoration, so they are neither buttons nor keyboard stops.
    <div aria-hidden="true" className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-1">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(
          (key) => (
            <span
              key={key}
              className="flex h-6 items-center justify-center rounded border border-border bg-background font-mono text-[10px] text-muted-foreground shadow-sm"
            >
              {key}
            </span>
          )
        )}
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted shadow-inner">
          <div className="h-5 w-1 rounded-full bg-zinc-900" />
        </div>
        <span className="text-[9px] tracking-widest text-muted-foreground uppercase">
          Coin
        </span>
      </div>
      <div className="rounded-md border border-border bg-muted p-2">
        <div className="h-1.5 rounded-full bg-zinc-900" />
      </div>
    </div>
  )
}

/* Usage (inside a project with Tailwind and the shadcn theme configured):

import { VendingMachine } from "./vending-machine";

export default function Example() {
  return (
    <VendingMachine label="SNACKS" windowClassName="p-3">
      <YourComponent />
    </VendingMachine>
  );
}

Optional: pass `controls={<YourControls />}` to add real side-panel actions.
In Next.js, put event handlers in your own Client Component.
*/
