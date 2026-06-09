// Lightweight liveness endpoint for Railway healthchecks. Returns 200 the
// instant the server is listening — no auth, no DB — so Railway switches
// traffic to a new deploy as soon as it can boot instead of waiting for a
// real page (`/`) to render. 2026-06-09: cuts the "Deploying…" cutover wait.
export const dynamic = "force-dynamic"

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  })
}
