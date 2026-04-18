/**
 * POST /api/ai/generate-report
 *
 * Thin wrapper over `generateReportFromPrompt` server action. The action
 * owns:
 *   - facility auth
 *   - deterministic report-type classification
 *   - Claude call + structured output parsing
 *   - audit logging
 *
 * This route just handles JSON plumbing + rate limiting.
 */
import { headers } from "next/headers"
import { z } from "zod"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { generateReportFromPrompt } from "@/lib/actions/ai/report-generator"

const generateBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
})

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { success, retryAfterMs } = rateLimit(
    `ai-generate-report:${session.user.id}`,
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

  const parsed = generateBodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 })
  }

  try {
    const report = await generateReportFromPrompt({ prompt: parsed.data.prompt })
    return Response.json({ report })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report generation failed"
    console.error("[/api/ai/generate-report] failed:", err)
    return Response.json({ error: message }, { status: 500 })
  }
}
