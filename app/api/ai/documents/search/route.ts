/**
 * POST /api/ai/documents/search
 *
 * Thin wrapper over `searchFacilityDocuments` server action. The action
 * already performs facility scoping, auth, and in-memory term-frequency
 * ranking — this route just handles JSON plumbing + rate limiting.
 */
import { headers } from "next/headers"
import { z } from "zod"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { searchFacilityDocuments } from "@/lib/actions/ai/document-index"

const searchBodySchema = z.object({
  query: z.string().min(1),
  vendorFilter: z.string().nullable().optional(),
  documentTypeFilter: z.string().nullable().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { success, retryAfterMs } = rateLimit(
    `ai-doc-search:${session.user.id}`,
    30,
    60_000,
  )
  if (!success) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = searchBodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 })
  }

  try {
    const hits = await searchFacilityDocuments({
      query: parsed.data.query,
      vendorFilter: parsed.data.vendorFilter ?? null,
      documentTypeFilter: parsed.data.documentTypeFilter ?? null,
      limit: parsed.data.limit,
    })
    return Response.json({ hits })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed"
    console.error("[/api/ai/documents/search] failed:", err)
    return Response.json({ error: message }, { status: 500 })
  }
}
