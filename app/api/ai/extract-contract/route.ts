import { generateText, Output } from "ai"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { geminiModel } from "@/lib/ai/config"
import {
  extractedContractSchema,
  richContractExtractSchema,
  type ExtractedContractData,
  type RichContractExtractData,
} from "@/lib/ai/schemas"
import {
  getDemoExtractedData,
  toLegacyExtractedContract,
} from "@/lib/ai/demo-contract-extract"
import { uploadFile } from "@/lib/storage"
import { rateLimit } from "@/lib/rate-limit"

const RICH_SYSTEM_PROMPT = `You are an expert at extracting healthcare contract information.

Extract ALL available information from this contract document. This is for a medical device/supply contract management system.

CONTRACT TYPES TO IDENTIFY:
- usage: Standard contracts with spend or volume-based rebates
- capital: Equipment purchase contracts with payment schedules
- service: Maintenance, support, or consulting service agreements
- tie_in: Hybrid contracts where capital/service payments are tied to consumable purchases
- grouped: Contracts spanning multiple vendor divisions with combined rebate structures
- pricing_only: Price-only agreements that lock in specific pricing without rebate structures

KEY THINGS TO EXTRACT:
- Contract name, vendor, vendor division, product categories
- Effective and expiration dates
- Rebate structures with tiers (spend thresholds, volume thresholds, market share requirements)
- Types of rebates: spend-based, volume-based, market share, capitated pricing, etc.
- Facilities covered by the contract
- Special conditions or carve-outs
- For tie_in contracts: capital equipment values and payoff terms
- For pricing_only contracts: locked pricing details and any price protection clauses
- Procedure codes or catalog numbers if listed

Be thorough - extract every tier, product, and condition mentioned. Use null for fields not found in the document.`

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
        model: geminiModel,
        output: Output.object({ schema: extractedContractSchema }),
        prompt: `Parse this contract information into structured data. Be precise with numbers and dates.

CONTRACT TYPE RULES (choose the most specific match):
- "usage" = contract has rebate tiers based on spend thresholds or volume commitments.
- "capital" = purchase/lease of specific equipment (robots, imaging systems, etc.)
- "service" = service-level agreements, maintenance, consulting
- "tie_in" = bundled deals linking equipment purchase to supply commitments
- "grouped" = GPO/group purchasing organization contracts covering multiple vendors
- "pricing_only" = ONLY use this if the document is purely a price list with NO rebates

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
    const demoMode = formData.get("demoMode") === "true"
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

    // If explicit demo mode, skip AI entirely.
    if (demoMode) {
      const rich = getDemoExtractedData(file.name)
      const legacy = toLegacyExtractedContract(rich)
      return Response.json({
        success: true,
        extracted: legacy,
        richExtracted: rich,
        confidence: 0.75,
        demoMode: true,
      })
    }

    // Read file bytes (fall back to demo on read failure).
    let bytes: ArrayBuffer
    try {
      bytes = await file.arrayBuffer()
    } catch (err) {
      console.warn("[extract-contract] File read failed, using demo extraction:", err)
      const rich = getDemoExtractedData(file.name)
      const legacy = toLegacyExtractedContract(rich)
      return Response.json({
        success: true,
        extracted: legacy,
        richExtracted: rich,
        confidence: 0.5,
        demoMode: true,
        aiError: "File read failed - using demo extraction",
      })
    }
    const fileData = new Uint8Array(bytes)

    // Archive original file to S3 (best-effort).
    let s3Key: string | undefined
    const userId = session.user.id
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const candidateKey = `contracts/${userId}/${timestamp}-${safeName}`
    try {
      await uploadFile(candidateKey, fileData, file.type || "application/octet-stream")
      s3Key = candidateKey
    } catch (uploadErr) {
      console.warn("[extract-contract] S3 archival skipped:", uploadErr)
    }

    const mediaType: "application/pdf" = "application/pdf"

    // Rich single-shot extraction.
    let rich: RichContractExtractData | undefined
    try {
      const result = await generateText({
        model: geminiModel,
        output: Output.object({ schema: richContractExtractSchema }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  RICH_SYSTEM_PROMPT +
                  (userInstructions
                    ? `\n\nAdditional user instructions:\n${userInstructions}`
                    : ""),
              },
              {
                type: "file",
                data: fileData,
                mediaType,
                filename: file.name,
              },
            ],
          },
        ],
      })

      try {
        rich = result.output
      } catch {
        const rawText = result.text ?? ""
        console.error(
          "[extract-contract] Schema validation failed. Raw AI response:",
          rawText.slice(0, 2000)
        )
        rich = tryParseRich(rawText)
      }
    } catch (aiError: unknown) {
      const errorMessage = aiError instanceof Error ? aiError.message : "Unknown error"
      console.warn("[extract-contract] Gemini unavailable, using demo extraction:", errorMessage)
      const demo = getDemoExtractedData(file.name)
      const legacy = toLegacyExtractedContract(demo)
      return Response.json({
        success: true,
        extracted: legacy,
        richExtracted: demo,
        confidence: 0.5,
        s3Key,
        demoMode: true,
        aiError: `AI parsing unavailable: ${errorMessage.substring(0, 200)}`,
      })
    }

    if (!rich) {
      // Last-ditch fallback — never 500 on the user.
      const demo = getDemoExtractedData(file.name)
      const legacy = toLegacyExtractedContract(demo)
      return Response.json({
        success: true,
        extracted: legacy,
        richExtracted: demo,
        confidence: 0.5,
        s3Key,
        demoMode: true,
        aiError: "Could not parse AI response",
      })
    }

    const legacy = toLegacyExtractedContract(rich)
    // Confidence: how many top-level rich fields were populated.
    const populated = Object.values(rich).filter((v) => v !== null && v !== undefined).length
    const confidence = Math.min(0.95, populated / 15)

    return Response.json({
      success: true,
      extracted: legacy,
      richExtracted: rich,
      confidence,
      s3Key,
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

function tryParseRich(rawText: string): RichContractExtractData | undefined {
  const attempts = buildParseAttempts(rawText)
  for (const attempt of attempts) {
    try {
      return richContractExtractSchema.parse(attempt())
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
