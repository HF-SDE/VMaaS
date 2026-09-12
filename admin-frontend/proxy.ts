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
    "/((?!api|_next/static|_next/image|favicon.ico|login|sign-up|welcome|verify-email|forgot-password|reset-password).*)",
  ],
}
