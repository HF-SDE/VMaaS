import { config } from "@/lib/config"

// Uptime-monitor target: 200 when the frontend is up and can reach the
// backend's /api/health, 500 otherwise.
export async function GET() {
  const healthy = await fetch(
    new URL("/api/health", config.BACKEND_INTERNAL_URL),
    { cache: "no-store", signal: AbortSignal.timeout(5000) }
  )
    .then((res) => res.ok)
    .catch(() => false)

  return new Response(JSON.stringify({ healthy }), {
    status: healthy ? 200 : 500,
  })
}
