/**
 * Streaming variant of /api/ai/extract-contract.
 *
 * Same auth, same archival, same cache lookup as the non-streaming
 * route — but on a cache miss it streams partial JSON via SSE so the
 * client dialog can paint fields as Claude emits them. Cuts the
 * "staring at spinner" UX from 20-30s to perceived-instant.
 *
 * Implementation per ai-sdk.dev (verified via context7):
 *   const result = streamText({ output: Output.object({ schema }), ... })
 *   return result.toTextStreamResponse()
 *
 * Uses the same generateStructured helper's provider config
 * (jsonTool mode, prompt cache) but inlined here because streamText
 * needs a different return shape.
 *
 * Cache hits return the full extract immediately as a single SSE
 * "data:" event then close — same envelope shape as the non-stream
 * route's JSON body.
 */

import { streamText, Output } from "ai"
import { headers } from "next/headers"
import { createHash } from "node:crypto"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { uploadFile } from "@/lib/storage"
import { claudeModel } from "@/lib/ai/config"
import { extractedContractSchema } from "@/lib/ai/schemas"

export const maxDuration = 60

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { success } = rateLimit(`ai-extract-stream:${session.user.id}`, 10, 60_000)
  if (!success) {
    return Response.json({ error: "Too many requests" }, { status: 429 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return Response.json({ error: "No file provided" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "Contract uploads must be PDF" },
      { status: 415 },
    )
  }

  const fileData = new Uint8Array(await file.arrayBuffer())
  const userId = session.user.id
  const fileHash = createHash("sha256").update(fileData).digest("hex")

  // Cache lookup — return as a single SSE event that the client
  // consumes the same way as the streamed events.
  const cached = await prisma.contractExtractionCache.findUnique({
    where: { userId_fileHash: { userId, fileHash } },
  })
  if (cached && cached.expiresAt > new Date()) {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        const payload = {
          extracted: cached.extracted,
          confidence: cached.confidence ?? 0.9,
          s3Key: cached.s3Key,
          cached: true,
          done: true,
        }
        controller.enqueue(encoder.encode(JSON.stringify(payload)))
        controller.close()
      },
    })
    return new Response(body, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  // Best-effort S3 archival.
  let s3Key: string | undefined
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const candidateKey = `contracts/${userId}/${Date.now()}-${safeName}`
  try {
    await uploadFile(candidateKey, fileData, file.type || "application/pdf")
    s3Key = candidateKey
  } catch (err) {
    console.warn("[extract-contract/stream] S3 archival skipped:", err)
  }

  // Stream the extraction. partialOutputStream emits incrementally
  // valid JSON chunks; the AI SDK's toTextStreamResponse() serializes
  // them on the wire as plain text the client can parse incrementally.
  const result = streamText({
    model: claudeModel,
    output: Output.object({ schema: extractedContractSchema }),
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" as const },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Extract every field of the attached contract into the structured schema. Be thorough — capture all rebate terms, every tier, every product category. For optional numeric fields you can't determine, omit them or use null (not the string "null").`,
          },
          {
            type: "file",
            data: fileData,
            mediaType: "application/pdf",
            filename: file.name,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" as const } },
            },
          },
        ],
      },
    ],
    onFinish: async ({ text }) => {
      // Persist on completion — write the cache row + S3 archival key
      // so subsequent uploads of the same PDF are instant.
      try {
        const trimmed = text.trim()
        const parsed = JSON.parse(trimmed)
        const validated = extractedContractSchema.safeParse(parsed)
        if (validated.success) {
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + 30)
          await prisma.contractExtractionCache.upsert({
            where: { userId_fileHash: { userId, fileHash } },
            create: {
              userId,
              fileHash,
              filename: file.name,
              extracted: validated.data as object,
              confidence: 0.9,
              s3Key,
              expiresAt,
            },
            update: {
              extracted: validated.data as object,
              confidence: 0.9,
              s3Key,
              expiresAt,
            },
          })
        }
      } catch (err) {
        console.warn("[extract-contract/stream] cache write skipped:", err)
      }
    },
  })

  return result.toTextStreamResponse()
}
