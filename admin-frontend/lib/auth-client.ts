import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  baseURL:
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    (() => {
      throw new Error("NEXT_PUBLIC_BACKEND_URL is not defined")
    })(),
  fetchOptions: {
    credentials: "include",
  },
})
