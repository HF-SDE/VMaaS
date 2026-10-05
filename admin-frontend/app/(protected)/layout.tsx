import { Suspense } from "react"

import { AppSidebar, AppSidebarSkeleton } from "@/components/app-sidebar"
import { PriceSyncListener } from "@/components/price-sync-listener"
import { SidebarSession } from "@/components/sidebar-session"
import { SiteHeader } from "@/components/site-header"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <Suspense fallback={<AppSidebarSkeleton />}>
          <SidebarSession>
            <AppSidebar variant="inset" />
            <PriceSyncListener />
          </SidebarSession>
        </Suspense>
        <SidebarInset className="min-w-0 overflow-x-hidden">
          <SiteHeader />
          <main className="p-4 lg:px-8">{children}</main>
          <Toaster />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
