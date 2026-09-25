"use client"

import React from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

function labelForSegment(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

export function DynamicBreadcrumbs() {
  const pathname = usePathname()

  // Split and filter empty segments
  const segments = pathname.split("/").filter(Boolean)

  const crumbs = segments.map((segment, i) => ({
    label: labelForSegment(segment),
    href: "/" + segments.slice(0, i + 1).join("/"),
  }))

  // Root always present as "Hjem"
  const allCrumbs = [{ label: "Hjem", href: "/" }, ...crumbs]

  return (
    <Breadcrumb className="min-w-0 flex-1 overflow-x-auto">
      <BreadcrumbList className="w-max min-w-full flex-nowrap whitespace-nowrap">
        {allCrumbs.map((crumb, i) => {
          const isLast = i === allCrumbs.length - 1
          return (
            <React.Fragment key={crumb.href}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={<Link href={crumb.href}>{crumb.label}</Link>}
                  ></BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
