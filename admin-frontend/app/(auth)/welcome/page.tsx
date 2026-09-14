import { Tenant } from "@prisma"
import WelcomePageClient from "./client"
import { fetchData } from "@/lib/data/data-fetch"

export const instant = false

export default async function WelcomePage() {
  const [err, tenants] = await fetchData<Tenant[]>("/api/tenants")

  if (err) {
    console.error(err)
    return <div>Error loading tenants</div>
  }

  return <WelcomePageClient tenants={tenants} />
}
