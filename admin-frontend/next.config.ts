import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  cacheComponents: true,
  turbopack: {
    // @vmaas/shared is a file: link to ../shared and tsconfig paths reach into
    // ../backend/src. Turbopack only resolves files under its root, so the root
    // must be the parent that holds all three. On the host Next infers this from
    // the repo's root lockfile; in Docker (/usr/src/app) there is none, so be explicit.
    root: path.join(import.meta.dirname, ".."),
  },
}
export default nextConfig
