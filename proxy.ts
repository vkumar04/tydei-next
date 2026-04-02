import { type NextRequest, NextResponse } from "next/server"

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "on",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
}

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

  const response = NextResponse.next()

  // Apply security headers to every protected route response
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value)
  }

  return response
}

export const config = {
  matcher: ["/dashboard/:path*", "/vendor/:path*", "/admin/:path*"],
}
