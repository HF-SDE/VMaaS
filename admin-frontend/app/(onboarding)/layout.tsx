import Link from "next/link"
import { GalleryVerticalEnd } from "lucide-react"

/**
 * Shell for every step between signing in and reaching the application:
 * onboarding, the organization selector and the billing pages.
 *
 * Deliberately outside `(protected)` — these pages are what a user sees when
 * they do *not* yet satisfy the protected layout's requirements, so nesting
 * them there would be circular.
 *
 * Like `(protected)/layout.tsx`, it performs no auth read of its own: each page
 * guards itself, so the shell stays static.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <Link href="/" className="flex items-center gap-2 self-center font-medium">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <GalleryVerticalEnd className="size-4" />
        </div>
        VMaaS
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
