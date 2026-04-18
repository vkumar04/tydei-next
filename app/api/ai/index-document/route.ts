/**
 * POST /api/ai/index-document
 *
 * Thin wrapper around the `indexContractDocument` server action. The client
 * uploads either raw text or a plain-text transcript of a PDF; we hand that
 * off to the action which splits it into pages and persists
 * `ContractDocumentPage` rows.
 *
 * Body (JSON):
 *   {
 *     documentId: string   // existing ContractDocument row id
 *     rawText:    string   // form-feed-delimited or single-blob text
 *   }
 *
 * The action already owns ownership checks, audit logging, and the
 * `indexStatus` state machine. This route only handles auth + rate
 * limiting + JSON plumbing.
 */
import { headers } from "next/headers"
import { z } from "zod"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { indexContractDocument } from "@/lib/actions/ai/document-index"

const indexBodySchema = z.object({
  documentId: z.string().min(1),
  rawText: z.string(),
})

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { success, retryAfterMs } = rateLimit(
    `ai-index-document:${session.user.id}`,
    10,
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

  const parsed = indexBodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 })
  }

  try {
    const result = await indexContractDocument({
      documentId: parsed.data.documentId,
      rawText: parsed.data.rawText,
    })
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Indexing failed"
    console.error("[/api/ai/index-document] failed:", err)
    return Response.json({ error: message }, { status: 500 })
  }
}
