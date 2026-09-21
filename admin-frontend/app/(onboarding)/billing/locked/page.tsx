import Link from "next/link"
import { redirect } from "next/navigation"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getSession } from "@/lib/dal"
import { resolveUserAccess } from "@/lib/access"

import { SwitchOrganizationButton } from "./switch-button"

export const instant = false

export const metadata = { title: "Organization locked" }

/**
 * What a non-owner sees when their organization's subscription has lapsed.
 *
 * Deliberately offers no way to pay: billing belongs to the owner, and a
 * member who could start a subscription on someone else's organization would
 * be a hole, not a convenience.
 */
export default async function BillingLockedPage() {
  const session = await getSession()
  const access = resolveUserAccess(session)

  if (access.accessState === "AUTH_REQUIRED") redirect("/login")
  if (access.accessState === "NO_ORGANIZATION") redirect("/onboarding")

  // An owner has something to do about this; send them where they can do it.
  if (access.accessState === "BILLING_REQUIRED") redirect("/billing")

  // Nothing is wrong any more — an owner may have paid while this user sat on
  // the page.
  if (access.accessState === "READY") redirect("/")

  const organization = access.memberships.find(
    (tenant) => tenant.id === access.activeTenantId
  )

  // Being in more than one organization means this lock need not be a dead
  // end: the others may well be fine.
  const hasOtherOrganizations = access.memberships.length > 1

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
          <Lock className="size-5 text-muted-foreground" />
        </div>
        <CardTitle>
          {organization?.name ?? "This organization"} is locked
        </CardTitle>
        <CardDescription>
          Access is disabled because this organization does not have an active
          subscription.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-muted-foreground">
          An owner of this organization needs to reactivate billing before you
          can continue. Please contact them — you cannot change billing
          yourself.
        </p>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-2">
        {hasOtherOrganizations && <SwitchOrganizationButton />}
        <Button variant="ghost" render={<Link href="/account" />}>
          Account settings
        </Button>
      </CardFooter>
    </Card>
  )
}
