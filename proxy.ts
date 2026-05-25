import { type NextRequest, NextResponse } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "on",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isApi = path.startsWith("/api/")

  // Cookie presence is the optimistic check. Actual session validation
  // happens in each protected page/action via requireFacility/Vendor/Admin.
  // getSessionCookie handles the better-auth cookie-prefix + __Secure-
  // variants for us, so we don't drift if naming conventions change.
  const sessionToken = getSessionCookie(request)

  if (!sessionToken) {
    // API routes: return 401 instead of redirect
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Page routes: redirect to login
    const url = new URL("/login", request.url)
    url.searchParams.set("callbackUrl", request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  const response = NextResponse.next()

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value)
  }

  return response
}

// The matcher excludes /api/auth/ and /api/webhooks/ via negative lookahead
// so the proxy isn't invoked for unauthenticated routes — saves a function
// call per better-auth round-trip and per webhook delivery.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/vendor/:path*",
    "/admin/:path*",
    "/api/((?!auth/|webhooks/).*)",
  ],
}
