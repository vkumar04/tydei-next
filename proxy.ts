import { type NextRequest, NextResponse } from "next/server"

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "on",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
}

// Public API routes that don't require a session cookie
const PUBLIC_API = ["/api/auth/", "/api/webhooks/"]

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isApi = path.startsWith("/api/")
  const isPublicApi = PUBLIC_API.some((prefix) => path.startsWith(prefix))

  const sessionToken =
    request.cookies.get("__Secure-better-auth.session_token")?.value ||
    request.cookies.get("better-auth.session_token")?.value

  if (!sessionToken && !isPublicApi) {
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

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/vendor/:path*",
    "/admin/:path*",
    "/api/:path*",
  ],
}
