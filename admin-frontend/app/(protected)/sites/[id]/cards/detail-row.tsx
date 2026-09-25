import type { ReactNode } from "react"

/** One `<dl>` row. Renders a dash rather than nothing when the column is null,
 *  so a card keeps its shape whatever the site has filled in. */
export function DetailRow({
  label,
  value,
  className,
}: {
  label: string
  value: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  )
}
