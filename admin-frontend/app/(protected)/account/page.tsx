import { Suspense } from "react"
import { PERMISSIONS } from "../../../../shared/types/permissions"

import { requireUser } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { InvoicesCard } from "./invoices-card"

export default function AccountPage() {
  return (
    <main>
      {/* Static: prerendered into the shell. */}
      <h1>Konto</h1>

      {/* Reads the session, so it streams in behind the boundary. */}
      <Suspense fallback={<p>Indlæser konto…</p>}>
        <AccountSection />
      </Suspense>
    </main>
  )
}

async function AccountSection() {
  const session = await requireUser()

  return (
    <>
      <Tabs defaultValue="overview" className="w-[400px]">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>
                View your key metrics and recent project activity. Track
                progress across all your active projects.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              You have 12 active projects and 3 pending tasks.
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="subscription">
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>
                Manage your subscription plan and billing details. Upgrade or
                cancel your subscription as needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Page views are up 25% compared to last month.
            </CardContent>
          </Card>
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
