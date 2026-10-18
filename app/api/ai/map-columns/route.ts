import { JevNotConfiguredError, mapColumnsWithJev } from "@/lib/ai/jev-column-mapping"
import { headers } from "next/headers"
import { z } from "zod"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { denyUnlessWriter } from "@/lib/api/import-route-auth"

const requestSchema = z.object({
  sourceHeaders: z.array(z.string()).min(1),
  targetFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      required: z.boolean(),
    })
  ),
  sampleRows: z.array(z.record(z.string(), z.string())).max(5).optional(),
})

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const denied = await denyUnlessWriter(session.user.id)
    if (denied) return denied

    const { success, retryAfterMs } = rateLimit(
      `ai-map-cols:${session.user.id}`,
      30,
      60_000
    )
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const parsedBody = requestSchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return Response.json(
        { error: "Invalid column-mapping request", details: parsedBody.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      )
    }
    const body = parsedBody.data

    const mapping = await mapColumnsWithJev(
      body.sourceHeaders,
      body.targetFields,
      body.sampleRows ?? [],
      request.signal,
    )

    return Response.json({ mapping })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 })
    }
    if (error instanceof JevNotConfiguredError) {
      console.warn("[map-columns] TYPESAFE_API_KEY unset")
      return Response.json({ error: "Column mapping is not configured" }, { status: 503 })
    }
    console.error("[map-columns]", error)
    return Response.json({ error: "Mapping failed" }, { status: 500 })
  }
}
