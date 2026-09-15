import { requireUser } from "@/lib/dal"
import { SessionProvider } from "@/lib/session-provider"

export async function SidebarSession({ children }: { children: React.ReactNode }) {
  const session = await requireUser()
  return <SessionProvider session={session}>{children}</SessionProvider>
}
