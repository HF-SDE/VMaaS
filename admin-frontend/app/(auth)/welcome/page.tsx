import WelcomePageClient from "./client"

import { getSession } from "@/lib/dal"

export const instant = false

export default async function WelcomePage() {
  const session = await getSession(true)

  return (
    <WelcomePageClient
      tenants={session.tenants}
      tenantInvites={session.tenantInvites}
    />
  )
}
