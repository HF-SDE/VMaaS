import { Suspense } from "react"
import { PERMISSIONS } from "../../../../shared/types/permissions"

import { requireUser } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { InvoicesCard } from "./invoices-card"
import { PaymentMethodCard } from "./payment-method-card"
import { PlanCard } from "./plan-card"
import { ProfileCard } from "./profile-card"

export default function AccountPage() {
  return (
    <main>
      {/* Static: prerendered into the shell. */}
      <h1>Account</h1>

      {/* Reads the session, so it streams in behind the boundary. */}
      <Suspense fallback={<p>Loading account…</p>}>
        <AccountSection />
      </Suspense>
    </main>
  )
}

async function AccountSection() {
  const session = await requireUser()

  return (
    <>
      <Tabs defaultValue="overview" className="w-full max-w-2xl">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <ProfileCard name={session.user.name} email={session.user.email} />
        </TabsContent>
        <TabsContent value="subscription" className="grid gap-4">
          {/* The plan is read off the session this page already has; only the
              portal button needs the browser. */}
          <PlanCard subscription={session.subscription} />
          <PaymentMethodCard />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesCard />
        </TabsContent>
      </Tabs>
      <p>Welcome, {session.user.name}</p>
      {hasPermission(session, PERMISSIONS.TENANT_MANAGE) && (
        <p>Administrator</p>
      )}
    </>
  )
}
