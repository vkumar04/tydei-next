import { type NextRequest, NextResponse } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// The baseline security headers (HSTS, X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, Permissions-Policy, CSP) now live in next.config.ts'
// async headers() so they apply to EVERY route, including public pages like
// /login. Only X-DNS-Prefetch-Control stays here (not part of that baseline
// set); leaving the others out avoids double-setting / drift.
const securityHeaders = {
  "X-DNS-Prefetch-Control": "on",
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

// The matcher excludes /api/auth/, /api/webhooks/, /api/health, and
// /api/cron/ via negative lookahead so the proxy isn't invoked for
// unauthenticated routes — saves a function call per better-auth
// round-trip and per webhook delivery.
// /api/health MUST stay public: it's the Railway healthcheck (railway.toml),
// and a 401 there would make the healthcheck never pass → deploys would hang.
// /api/cron/ routes carry their own Bearer CRON_SECRET auth (and 404 when
// the secret is unset) — the session-cookie proxy 401'd every scheduler
// call before the route's own guard could run (2026-06-09).
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/vendor/:path*",
    "/admin/:path*",
    "/api/((?!auth/|webhooks/|health|cron/).*)",
  ],
}
