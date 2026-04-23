import { generateText, Output } from "ai"
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

Be thorough - extract every tier, product, and condition mentioned. Use null for fields not found in the document.

── TIER EXTRACTION (CRITICAL) ──
Usage contracts ALMOST ALWAYS have rebate tiers. If the document mentions
ANY of the following, you MUST emit one row in terms[].tiers[] per tier:
- "X% on the first $Y, Z% above $Y"
- "X% rebate at spend $A–$B"
- "tier 1 … tier 2 … tier 3"
- "volume rebate: N units → X%"
- "market share Y% → rebate Z%"
- any table with thresholds and rebate percentages

For each tier:
- tierNumber: 1 = lowest threshold, counting up.
- spendMin / spendMax: the dollar thresholds. The first tier is spendMin=0.
  Open-ended top tiers have spendMax=null.
- volumeMin / volumeMax: unit thresholds for volume-based rebates.
- marketShareMin / marketShareMax: percentages (0-100) for market-share tiers.
- rebateType: "percent_of_spend" for % rebates, "fixed_rebate" for flat $,
  "fixed_rebate_per_unit" for $/unit, "per_procedure_rebate" for case-based.
- rebateValue: the percentage (e.g. 3 for 3%) or dollar amount.

Do NOT return an empty tiers array for a usage contract that clearly has a
tier structure. If the document is ambiguous, still emit your best-guess tiers
with rebateType="percent_of_spend" rather than dropping them entirely.

── LEGACY FALLBACK SHAPE ──
If the rich schema validation fails, respond with the legacy shape instead:
{
  "contractName": "...",
  "vendorName": "...",
  "contractType": "usage" | "capital" | ...,
  "effectiveDate": "YYYY-MM-DD",
  "expirationDate": "YYYY-MM-DD",
  "terms": [
    {
      "termName": "...",
      "termType": "spend_rebate",
      "tiers": [
        { "tierNumber": 1, "spendMin": 0, "spendMax": 750000, "rebateType": "percent_of_spend", "rebateValue": 3 },
        { "tierNumber": 2, "spendMin": 750000, "rebateType": "percent_of_spend", "rebateValue": 5 }
      ]
    }
  ]
}
Keep the tiers array NON-EMPTY whenever the contract has rebate structures.`

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

    // Route PDF through the simpler legacy schema — the rich schema has
    // >16 union-typed fields which Anthropic's tool-input JSON Schema
    // validator rejects. See docs/superpowers/qa/2026-04-19-contracts-sweep.md
    // bug new-1.
    let extracted: ExtractedContractData | undefined
    try {
      const result = await generateText({
        model: claudeModel,
        output: Output.object({ schema: extractedContractSchema }),
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
        extracted = result.output
      } catch {
        const rawText = result.text ?? ""
        console.error(
          "[extract-contract] Schema validation failed. Raw AI response:",
          rawText.slice(0, 2000)
        )
        extracted = tryParseLegacy(rawText)
      }
    } catch (aiError: unknown) {
      const errorMessage = aiError instanceof Error ? aiError.message : "Unknown error"
      console.warn("[extract-contract] AI extraction failed:", errorMessage)
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
    return Response.json({
      success: true,
      extracted,
      confidence: 0.9,
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
