import { generateText, Output } from "ai"
import {
  generateStructured,
  withCacheControl,
} from "@/lib/ai/generate-structured"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { claudeModel } from "@/lib/ai/config"
import {
  extractedContractSchema,
  type ExtractedContractData,
} from "@/lib/ai/schemas"
import { uploadFile } from "@/lib/storage"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"
import { createHash } from "node:crypto"

import { getActiveContractExtractPrompt } from "@/lib/ai/prompts/contract-extract"

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`ai-extract:${session.user.id}`, 10, 60_000)
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    // Check content length before parsing
    const contentLength = request.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_BYTES) {
      return Response.json(
        {
          error: "File too large. Maximum size is 10MB.",
          details: "Please upload a smaller file or compress the PDF.",
        },
        { status: 413 }
      )
    }

    const contentType = request.headers.get("content-type") ?? ""

    // ── Text-based extraction (JSON body) — kept for AITextExtract ──
    if (contentType.includes("application/json")) {
      const body = await request.json()
      const text = body.text as string | undefined
      if (!text || !text.trim()) {
        return Response.json({ error: "No text provided" }, { status: 400 })
      }

      // Use the legacy (simpler) schema for raw-text parsing.
      const result = await generateText({
        model: claudeModel,
        output: Output.object({ schema: extractedContractSchema }),
        prompt: `Parse this contract information into structured data. Be precise with numbers and dates.

CONTRACT TYPE RULES (choose the most specific match):
- "usage" = contract has rebate tiers based on spend thresholds or volume commitments.
- "capital" = purchase/lease of specific equipment (robots, imaging systems, etc.)
- "service" = service-level agreements, maintenance, consulting
- "tie_in" = bundled deals linking equipment purchase to supply commitments
- "grouped" = GPO/group purchasing organization contracts covering multiple vendors
- "pricing_only" = ONLY use this if the document is purely a price list with NO rebates

TIER EXTRACTION (CRITICAL): usage contracts ALMOST ALWAYS have tiered rebates.
If the text mentions phrases like "X% on the first $Y", "Z% above $Y", "tier 1/2/3",
"volume rebate: N units → X%", or any table of spend thresholds with percentages,
you MUST emit one row per tier inside terms[].tiers[]:
- tierNumber: 1 for the lowest, counting up.
- spendMin / spendMax: dollar thresholds (spendMin=0 on tier 1, spendMax may be null on the top tier).
- rebateType: "percent_of_spend" for percentages, "fixed_rebate" for flat $ amounts.
- rebateValue: the percentage number (3 for 3%) or the dollar amount.
Do NOT return an empty tiers array for a usage contract that clearly has a tier structure.

EVERGREEN: return expirationDate: null ONLY if the contract EXPLICITLY
auto-renews without affirmative action ("automatically renews", "remains
in effect until terminated"). A fixed-term contract with termination-
for-convenience or mutual-consent extensions is NOT evergreen — emit
the stated end date.

Return valid JSON only — no markdown fences.

Contract information:
${text.trim()}`,
      })

      let extracted: ExtractedContractData | undefined
      try {
        extracted = result.output
      } catch {
        const rawText = result.text ?? ""
        extracted = tryParseLegacy(rawText)
      }
      if (!extracted) {
        return Response.json(
          { error: "Could not parse extracted data." },
          { status: 422 }
        )
      }
      await recordExtractUsage(session.user.id, session.user.name ?? session.user.email ?? "Unknown", `Extracted contract: ${extracted.contractName ?? "Untitled"}`)
      return Response.json({
        extracted,
        confidence: 0.9,
      })
    }

    // ── File-based extraction ──────────────────────────────────────
    let formData: FormData
    try {
      formData = await request.formData()
    } catch (err) {
      console.error("[extract-contract] FormData parsing error:", err)
      return Response.json(
        {
          error: "Failed to read uploaded file",
          details: "The file may be too large or the upload was interrupted.",
        },
        { status: 400 }
      )
    }

    const file = formData.get("file") as File | null
    const userInstructions = (formData.get("userInstructions") as string | null)?.trim() || ""

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    if (file.size > MAX_BYTES) {
      return Response.json(
        {
          error: "File too large",
          details: `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Maximum size is 10MB.`,
        },
        { status: 413 }
      )
    }

    // Read file bytes — fail loudly so the user can retry, instead of
    // returning placeholder content that looks like a real extraction.
    let bytes: ArrayBuffer
    try {
      bytes = await file.arrayBuffer()
    } catch (err) {
      console.warn("[extract-contract] File read failed:", err)
      return Response.json(
        {
          error: "Could not read uploaded file",
          details: err instanceof Error ? err.message : "Unknown error",
        },
        { status: 400 },
      )
    }
    const fileData = new Uint8Array(bytes)
    const userId = session.user.id

    // 2026-04-26 cache: SHA-256 the file bytes, look up a per-user
    // cache row. Same PDF re-uploaded → return the previous extract
    // in <50ms instead of re-spending a 20-30s Claude round-trip.
    // Per-user scoping prevents cross-tenant leakage even on
    // identical PDFs (two facilities could both have the same
    // standard contract template, but their extracted vendor /
    // facility-specific numbers shouldn't cross).
    const fileHash = createHash("sha256").update(fileData).digest("hex")
    const cached = await prisma.contractExtractionCache.findUnique({
      where: { userId_fileHash: { userId, fileHash } },
    })
    if (cached && cached.expiresAt > new Date()) {
      console.log(
        `[extract-contract] cache HIT for ${file.name} (hash=${fileHash.slice(0, 12)})`,
      )
      return Response.json({
        success: true,
        extracted: cached.extracted,
        confidence: cached.confidence ?? 0.9,
        s3Key: cached.s3Key,
        cached: true,
      })
    }

    // Archive original file to S3 (best-effort).
    let s3Key: string | undefined
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const candidateKey = `contracts/${userId}/${timestamp}-${safeName}`
    try {
      await uploadFile(candidateKey, fileData, file.type || "application/octet-stream")
      s3Key = candidateKey
    } catch (uploadErr) {
      console.warn("[extract-contract] S3 archival skipped:", uploadErr)
    }

    // 2026-04-26: contracts are PDF-only. The previous DOCX (mammoth)
    // and TXT paths have been removed — they were rarely used and the
    // dual-input branching obscured the main code path. Any other
    // format is rejected with a clear pointer to convert to PDF.
    const lowerName = file.name.toLowerCase()
    const isPdf = lowerName.endsWith(".pdf") || file.type === "application/pdf"
    if (!isPdf) {
      return Response.json(
        {
          error: "Contract uploads must be PDF",
          details:
            "Only PDF files are supported for contract extraction. Convert your DOCX/DOC/TXT to PDF and try again. CSV / Excel pricing files use a separate Pricing import flow.",
        },
        { status: 415 },
      )
    }

    const mediaType = "application/pdf" as const

    // Route PDF through the simpler legacy schema — the rich schema has
    // >16 union-typed fields which Anthropic's tool-input JSON Schema
    // validator rejects. See docs/superpowers/qa/2026-04-19-contracts-sweep.md
    // bug new-1.
    let extracted: ExtractedContractData | undefined
    try {
      const userContent: Array<
        | { type: "text"; text: string }
        | {
            type: "file"
            data: Uint8Array
            mediaType: "application/pdf"
            filename: string
            providerOptions?: {
              anthropic?: { cacheControl?: { type: "ephemeral" } }
            }
          }
      > = [
        {
          type: "text",
          text:
            getActiveContractExtractPrompt().prompt +
            (userInstructions
              ? `\n\nAdditional user instructions:\n${userInstructions}`
              : ""),
        },
        {
          type: "file",
          data: fileData,
          mediaType,
          filename: file.name,
          // Cache the PDF representation for ~5 min — re-uploads /
          // retries hit the cache instead of re-parsing the file.
          ...withCacheControl(),
        },
      ]

      // generateStructured handles:
      //   - Anthropic structuredOutputMode='jsonTool' (avoids the
      //     24-optional-param limit + grammar overload)
      //   - Opus → Sonnet fallback on transient errors
      //   - Logging the model used so retries are observable.
      const structured = await generateStructured({
        schema: extractedContractSchema,
        messages: [{ role: "user", content: userContent }],
        actionName: "extract-contract",
      })

      try {
        extracted = structured.output
      } catch {
        const rawText = structured.text
        console.error(
          "[extract-contract] Schema validation failed. Raw AI response:",
          rawText.slice(0, 2000)
        )
        extracted = tryParseLegacy(rawText)
      }
    } catch (aiError: unknown) {
      const errorMessage =
        aiError instanceof Error ? aiError.message : "Unknown error"
      // CLAUDE.md AI-action error path: log full context server-side
      // before returning a sanitized envelope to the client. console.error
      // (not warn) so prod log search picks it up.
      console.error("[extract-contract] AI extraction failed:", aiError, {
        fileSize: file.size,
        mediaType,
        s3Key,
      })
      return Response.json(
        {
          error: "AI extraction unavailable",
          details: errorMessage.substring(0, 400),
          s3Key,
        },
        { status: 502 },
      )
    }

    if (!extracted) {
      return Response.json(
        {
          error: "Could not parse AI response",
          details:
            "The model returned a response that did not match the expected contract schema. Try uploading again or use Manual Entry.",
          s3Key,
        },
        { status: 502 },
      )
    }

    await recordExtractUsage(
      session.user.id,
      session.user.name ?? session.user.email ?? "Unknown",
      `Extracted contract from ${file.name.slice(0, 40)}`,
    )

    // Cache the successful extract (best-effort — failure here
    // never blocks the user from getting the result).
    try {
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30) // 30-day TTL
      await prisma.contractExtractionCache.upsert({
        where: { userId_fileHash: { userId, fileHash } },
        create: {
          userId,
          fileHash,
          filename: file.name,
          extracted: extracted as object,
          confidence: 0.9,
          s3Key,
          expiresAt,
        },
        update: {
          extracted: extracted as object,
          confidence: 0.9,
          s3Key,
          expiresAt,
        },
      })
    } catch (cacheErr) {
      console.warn("[extract-contract] cache write failed:", cacheErr)
    }

    return Response.json({
      success: true,
      extracted,
      confidence: 0.9,
      s3Key,
      cached: false,
    })
  } catch (error) {
    console.error("Contract extraction error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"

    if (message.includes("timeout") || message.includes("DEADLINE_EXCEEDED")) {
      return Response.json(
        {
          error:
            "Document too large or complex. Try a shorter document or paste key sections as text instead.",
        },
        { status: 422 }
      )
    }
    if (message.includes("SAFETY") || message.includes("blocked")) {
      return Response.json(
        {
          error:
            "The document could not be processed by the AI model. Try pasting the contract text manually.",
        },
        { status: 422 }
      )
    }

    return Response.json(
      { error: `Extraction failed: ${message.slice(0, 200)}` },
      { status: 500 }
    )
  }
}

async function recordExtractUsage(
  userId: string,
  userName: string,
  description: string,
): Promise<void> {
  try {
    const member = await prisma.member.findFirst({
      where: { userId },
      include: {
        organization: { include: { facility: true, vendor: true } },
      },
    })
    await recordClaudeUsage({
      facilityId: member?.organization?.facility?.id ?? null,
      vendorId: member?.organization?.vendor?.id ?? null,
      userId,
      userName,
      action: "full_contract_analysis",
      description,
    })
  } catch (err) {
    console.error("[extract-contract] usage-record failed", err, { userId })
  }
}

/** Try multiple JSON-parsing strategies to rescue a malformed AI response. */
function tryParseLegacy(rawText: string): ExtractedContractData | undefined {
  const attempts = buildParseAttempts(rawText)
  for (const attempt of attempts) {
    try {
      return extractedContractSchema.parse(attempt())
    } catch {
      // try next
    }
  }
  return undefined
}

function buildParseAttempts(rawText: string): Array<() => unknown> {
  return [
    // Strategy 1: Strip markdown fences
    () => {
      const cleaned = rawText
        .replace(/```(?:json)?\s*\n?/g, "")
        .replace(/```\s*$/g, "")
        .trim()
      return JSON.parse(cleaned)
    },
    // Strategy 2: Extract JSON object from surrounding text
    () => {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error("No JSON object found")
      return JSON.parse(jsonMatch[0])
    },
    // Strategy 3: Extract JSON from within markdown code block
    () => {
      const codeBlockMatch = rawText.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/)
      if (!codeBlockMatch?.[1]) throw new Error("No code block found")
      return JSON.parse(codeBlockMatch[1])
    },
  ]
}
