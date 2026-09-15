import WelcomePageClient from "./client"

import { getSession } from "@/lib/dal"

export const instant = false

export default async function WelcomePage() {
  const session = await getSession()

  if (!session) return <div>Error loading tenants</div>

  return (
    <WelcomePageClient
      tenants={session.tenants}
      tenantInvites={session.tenantInvites}
    />
  )
}
