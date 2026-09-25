"use client"
import { Suspense } from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { DynamicBreadcrumbs } from "./dynamic-breadcrumbs"

export function SiteHeader() {
  return (
    <header className="z-30 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-full data-[orientation=vertical]:h-8"
        />
        {/* The breadcrumbs read the pathname, which a route with a dynamic
            segment only knows at request time. Behind its own boundary they
            stream in while the rest of the header stays in the static shell —
            without it, every such route blocks prerendering. */}
        <Suspense fallback={<Skeleton className="h-4 w-40" />}>
          <DynamicBreadcrumbs />
        </Suspense>
      </div>
    </header>
  )
}
