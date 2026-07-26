import { headers } from "next/headers"

/**
 * Best-effort client IP for rate-limit keys.
 *
 * Mirrors the header cascade `lib/actions/contact.ts` already used, lifted
 * here so every unauthenticated server action keys its limiter the same way
 * instead of re-inlining the cascade.
 *
 * Caveat: these headers are attacker-controllable in principle. Behind
 * Railway's proxy `x-forwarded-for` is set by the platform, and the left-most
 * entry is the client. This is a throttle, not an authorization boundary —
 * never use it for access control.
 */
export async function clientIp(): Promise<string> {
  const hdrs = await headers()
  const forwarded = hdrs.get("x-forwarded-for")
  return (
    forwarded?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "unknown"
  )
}
