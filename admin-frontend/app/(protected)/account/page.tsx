import { Suspense } from "react"
import { PERMISSIONS } from "../../../../shared/types/permissions"

import { requireUser } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"

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
      <p>Welcome, {session.user.name}</p>
      {hasPermission(session, PERMISSIONS.TENANT_MANAGE) && (
        <p>Administrator</p>
      )}
    </>
  )
}
