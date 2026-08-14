// Lightweight liveness endpoint for Railway healthchecks. Returns 200 the
// instant the server is listening — no auth, no DB — so Railway switches
// traffic to a new deploy as soon as it can boot instead of waiting for a
// real page (`/`) to render. 2026-06-09: cuts the "Deploying…" cutover wait.
import { headers } from "next/headers"

export const dynamic = "force-dynamic"

// TEMPORARY (remove after reading the logs): better-auth cannot resolve a
// client IP in production and falls back to one shared rate-limit bucket for
// the whole app. Logging the proxy headers server-side — never returning them —
// tells us which header Railway's edge actually sets, and with how many hops,
// so `advanced.ipAddress` can be configured correctly rather than guessed.
const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "x-envoy-external-address",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
]

export async function GET() {
  if (process.env.LOG_PROXY_HEADERS === "1") {
    const h = await headers()
    const seen: Record<string, string> = {}
    for (const name of PROXY_HEADERS) {
      const v = h.get(name)
      if (v !== null) seen[name] = v
    }
    console.log("[proxy-headers]", JSON.stringify(seen))
  }
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  })
}
