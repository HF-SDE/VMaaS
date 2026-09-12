import { ShieldXIcon } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { FORBIDDEN_FALLBACK_REASON, readForbiddenReason } from "@/lib/forbidden"

/**
 * Shown when a permission gate denies the user. The `reason` param carries
 * plain Danish copy written by whichever gate redirected here.
 *
 * It lives under (protected) so the denial keeps the sidebar shell — the user
 * is signed in and needs a way onwards, not a bare error screen.
 */
export default function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <div className="container mx-auto flex py-10">
      <Empty className="mx-auto max-w-md">
        {/* Static: prerendered into the shell. */}
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldXIcon />
          </EmptyMedia>
          <EmptyTitle>Adgang nægtet</EmptyTitle>

          {/* Reads searchParams, so only the wording streams in — keeping the
              await out here would make the whole page dynamic. */}
          <Suspense
            fallback={<EmptyDescription>{FORBIDDEN_FALLBACK_REASON}</EmptyDescription>}
          >
            <ForbiddenReason searchParams={searchParams} />
          </Suspense>
        </EmptyHeader>

        <EmptyContent>
          <Button render={<Link href="/" />}>Tilbage til oversigten</Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

async function ForbiddenReason({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  return <EmptyDescription>{readForbiddenReason(params["reason"])}</EmptyDescription>
}
