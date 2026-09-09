"use client"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"
import { Command } from "lucide-react"
import { usePathname } from "next/navigation"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
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
        <DynamicBreadcrumbs />
      </div>
    </header>
  )
}
