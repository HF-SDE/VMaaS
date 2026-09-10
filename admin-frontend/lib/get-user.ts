import { headers } from "next/headers"
import { authClient } from "./auth-client"

export async function getUserAndSession() {
  const headersList = await headers()

  const session = await authClient.getSession({
    fetchOptions: { headers: { cookie: headersList.get("cookie") ?? "" } },
  })

  return session
}
