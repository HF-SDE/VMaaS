import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { Suspense } from "react"
import { authClient } from "@/lib/auth-client"
import { UserProvider } from "@/hooks/use-user"

export default async function AuthShell({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()

  const { data, error } = await authClient.getSession({
    fetchOptions: { headers: { cookie: headersList.get("cookie") ?? "" } },
  })

  if (error || !data?.user) redirect("/login")

  return (
    <TooltipProvider>
      <UserProvider user={data.user}>
        <SidebarProvider
          style={
            {
              "--sidebar-width": "calc(var(--spacing) * 72)",
              "--header-height": "calc(var(--spacing) * 12)",
            } as React.CSSProperties
          }
        >
          <Suspense>
            <AppSidebar variant="inset" />
          </Suspense>

          <SidebarInset className="min-w-0 overflow-x-hidden">
            <SiteHeader />
            <main className="p-4 lg:px-8">{children}</main>
            <Toaster />
          </SidebarInset>
        </SidebarProvider>
      </UserProvider>
    </TooltipProvider>
  )
}
