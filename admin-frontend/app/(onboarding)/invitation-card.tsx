import { Badge } from "@/components/ui/badge"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"

/** Formats an expiry for display, tolerating a malformed date rather than
 *  throwing inside a render. */
export function formatExpiry(value: string | Date | undefined): string | null {
  if (!value) return null

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
  }).format(date)
}

/** One invitation, rendered the same way on /onboarding and /invite/[id] so the
 *  two never drift apart. `action` is whatever buttons the caller needs. */
export function InvitationCard({
  organizationName,
  roleName,
  invitedBy,
  expiresAt,
  action,
}: {
  organizationName: string
  roleName?: string
  invitedBy?: string
  expiresAt?: string | Date
  action?: React.ReactNode
}) {
  const expiry = formatExpiry(expiresAt)

  return (
    <Item variant="outline" className="items-start">
      <ItemContent>
        <ItemTitle className="text-base">
          You&apos;ve been invited to {organizationName}
        </ItemTitle>
        <ItemDescription className="space-y-1">
          {invitedBy && <span className="block">Invited by {invitedBy}</span>}
          {expiry && <span className="block">Expires {expiry}</span>}
        </ItemDescription>
        {roleName && (
          <Badge variant="secondary" className="mt-2 w-fit capitalize">
            {roleName}
          </Badge>
        )}
      </ItemContent>
      {action}
    </Item>
  )
}
