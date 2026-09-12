import { Tenant } from "@prisma"
import WelcomePageClient from "./client"
import { backendFetch } from "@/lib/backend"

export const instant = false

export default async function WelcomePage() {
  const tenants = await backendFetch<Tenant[]>("/api/tenants", {
    method: "GET",
  })

  return <WelcomePageClient tenants={tenants} />
}
