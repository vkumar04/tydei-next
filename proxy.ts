import { type NextRequest, NextResponse } from "next/server"

export function proxy(request: NextRequest) {
  const sessionToken =
    request.cookies.get("__Secure-better-auth.session_token")?.value ||
    request.cookies.get("better-auth.session_token")?.value

  // Redirect unauthenticated users to login
  // Server-side auth guards (requireAuth/requireFacility/requireVendor) handle
  // the real session validation — this is just a fast-path for missing cookies.
  if (!sessionToken) {
    const url = new URL("/login", request.url)
    url.searchParams.set("callbackUrl", request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/vendor/:path*", "/admin/:path*"],
}
