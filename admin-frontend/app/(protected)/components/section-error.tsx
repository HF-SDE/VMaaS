/**
 * One section's failure, shown inside that section's own card.
 *
 * Deliberately not the page-level error toast this replaced: with four sections
 * a toast no longer says which one broke, and a dashboard that renders three
 * good cards and one apology is more useful than one that goes blank.
 */
export function SectionError({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {message}
    </p>
  )
}
