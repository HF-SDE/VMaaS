import { inferAdditionalFields } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import { config } from "./config"

export const authClient = createAuthClient({
  baseURL: config.BACKEND_URL,
  plugins: [
    inferAdditionalFields({
      session: { activeTenantId: { type: "string", required: false } },
    }),
  ],
})
