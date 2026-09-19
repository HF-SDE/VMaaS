import { NextRequest, NextResponse } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// Optimistic redirect only: getSessionCookie does not validate the cookie.
// The real gate is lib/dal.ts, called per page. See the design spec.
export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // `invite` is exempt because an invitation link has to survive being opened
    // signed out: the page itself redirects to sign-in carrying its own URL, so
    // the visitor comes back to the invitation instead of landing on /login
    // with nothing to show for it.
    "/((?!api|_next/static|_next/image|favicon.ico|login|sign-up|invite|welcome|verify-email|forgot-password|reset-password).*)",
  ],
}
