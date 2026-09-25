import Loader from "@/components/loader/loader"
import { getSession } from "@/lib/dal"
import { forbiddenPath } from "@/lib/forbidden"
import { redirect } from "next/navigation"
import { Suspense } from "react"

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<Loader />}>
      <SuperAdminPages>{children}</SuperAdminPages>
    </Suspense>
  )
}

async function SuperAdminPages({ children }: { children: React.ReactNode }) {
  const session = await getSession(true)
  // Same denial page as the permission gates, so it looks alike everywhere
  if (session.user.isSuperAdmin !== true) {
    redirect(forbiddenPath("Only super admins have access to this page."))
  }

  return children
}
