import { type NextRequest, NextResponse } from "next/server"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const sessionToken = request.cookies.get("better-auth.session_token")?.value

  const isLoginRoute = pathname === "/login"
  const isProtectedRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/vendor") ||
    pathname.startsWith("/admin")

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !sessionToken) {
    const url = new URL("/login", request.url)
    url.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users from login to dashboard
  if (isLoginRoute && sessionToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return undefined
}
