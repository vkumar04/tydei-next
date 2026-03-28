import { type NextRequest, NextResponse } from "next/server"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const sessionToken = request.cookies.get("better-auth.session_token")?.value

  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/sign-up")
  const isFacilityRoute = pathname.startsWith("/dashboard")
  const isVendorRoute = pathname.startsWith("/vendor")
  const isAdminRoute = pathname.startsWith("/admin")
  const isProtectedRoute = isFacilityRoute || isVendorRoute || isAdminRoute

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !sessionToken) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && sessionToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return undefined
}
