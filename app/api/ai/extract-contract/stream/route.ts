/**
 * Streaming variant of /api/ai/extract-contract.
 *
 * Implementation per AI SDK 6 docs (context7 /vercel/ai 6.0.0-beta.128):
 *   const result = streamObject({ schema, ... })
 *   return result.toTextStreamResponse()
 *
 * Why streamObject (not streamText + Output.object): with Anthropic's
 * structuredOutputMode='jsonTool' the structured payload comes back via
 * a tool call, so streamText's `textStream` is empty and
 * toTextStreamResponse() produces an empty body — that's the silent
 * failure that bit the previous incarnation of this route. streamObject
 * is the purpose-built API; its textStream emits incrementally-valid
 * JSON chunks the client can JSON.parse() as they arrive.
 *
 * Cache hits return the full extract immediately as a single chunk and
 * close — same envelope shape as the non-stream route's JSON body so
 * the client dialog reads either response identically.
 */

import { streamObject } from "ai"
import { headers } from "next/headers"
import { createHash } from "node:crypto"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { uploadFile } from "@/lib/storage"
import { claudeModel } from "@/lib/ai/config"
import { extractedContractSchema } from "@/lib/ai/schemas"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import { getActiveContractExtractPrompt } from "@/lib/ai/prompts/contract-extract"

export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { success } = rateLimit(`ai-extract-stream:${session.user.id}`, 10, 60_000)
  if (!success) {
    return Response.json({ error: "Too many requests" }, { status: 429 })
  }

  const contentLength = req.headers.get("content-length")
  if (contentLength && parseInt(contentLength) > MAX_BYTES) {
    return Response.json(
      { error: "File too large", details: "Maximum size is 10MB." },
      { status: 413 },
    )
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const userInstructions =
    (formData.get("userInstructions") as string | null)?.trim() || ""
  if (!file) return Response.json({ error: "No file provided" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "Contract uploads must be PDF" },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: "File too large",
        details: `${(file.size / (1024 * 1024)).toFixed(1)}MB; max 10MB.`,
      },
      { status: 413 },
    )
  }

  const fileData = new Uint8Array(await file.arrayBuffer())
  const userId = session.user.id
  const fileHash = createHash("sha256").update(fileData).digest("hex")

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

  let s3Key: string | undefined
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const candidateKey = `contracts/${userId}/${Date.now()}-${safeName}`
  try {
    await uploadFile(candidateKey, fileData, file.type || "application/pdf")
    s3Key = candidateKey
  } catch (err) {
    console.warn("[extract-contract/stream] S3 archival skipped:", err)
  }

  const pdfText = await extractPdfText(fileData)
  const textHint = pdfText.hasTextLayer
    ? `\n\nFor reference, here is the extracted text layer of the PDF (may help with tabular data):\n\n${pdfText.text}`
    : ""
  if (!pdfText.hasTextLayer) {
    console.warn(
      `[extract-contract/stream] no text layer in ${file.name} (likely scanned, ${pdfText.pageCount} pages) — vision-only`,
    )
  }
  const userInstructionsHint = userInstructions
    ? `\n\nAdditional user instructions:\n${userInstructions}`
    : ""

  const result = streamObject({
    model: claudeModel,
    schema: extractedContractSchema,
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" as const },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              getActiveContractExtractPrompt().prompt +
              textHint +
              userInstructionsHint,
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
    onError: ({ error }) => {
      // CLAUDE.md AI-action error path: log full context server-side
      // before the SDK surfaces the failure to the client.
      console.error("[extract-contract/stream]", error, {
        userId,
        file: file.name,
        size: file.size,
      })
    },
    onFinish: async ({ object }) => {
      if (!object) return
      try {
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 30)
        await prisma.contractExtractionCache.upsert({
          where: { userId_fileHash: { userId, fileHash } },
          create: {
            userId,
            fileHash,
            filename: file.name,
            extracted: object as object,
            confidence: 0.9,
            s3Key,
            expiresAt,
          },
          update: {
            extracted: object as object,
            confidence: 0.9,
            s3Key,
            expiresAt,
          },
        })
      } catch (err) {
        console.warn("[extract-contract/stream] cache write skipped:", err)
      }
    },
  })

  // Charles 2026-04-30 bug doc — "No documents here for a faculty
  // to review". Root cause: this stream route uploaded the PDF to
  // S3 (above) AND wrote the s3Key into the cache row, but the
  // response stream itself never told the client what the key was.
  // The client (ai-extract-dialog.tsx:205) expected `lastValid.s3Key`
  // from the streamed JSON and got undefined every time, so vendor
  // submissions landed with documents:[] on the PendingContract
  // row — the facility-side review then correctly showed the "No
  // documents…" empty state.
  //
  // Fix: use the `X-S3-Key` response header to surface the archived
  // PDF location alongside the streaming JSON body. Header-based
  // metadata avoids changing the existing JSON-parse loop on the
  // client (which assembles a single progressive JSON object across
  // chunks); the client reads the header before consuming the body.
  const response = result.toTextStreamResponse()
  if (s3Key) response.headers.set("X-S3-Key", s3Key)
  return response
}
