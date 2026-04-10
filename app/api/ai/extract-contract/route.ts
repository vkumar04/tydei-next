import { generateText, Output } from "ai"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { geminiModel } from "@/lib/ai/config"
import { extractedContractSchema, type ExtractedContractData } from "@/lib/ai/schemas"
import { uploadFile } from "@/lib/storage"
import { rateLimit } from "@/lib/rate-limit"

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

    // Determine if this is a text-based request (JSON) or file upload (FormData)
    const contentType = request.headers.get("content-type") ?? ""
    let extractedText: string
    let s3Key: string | undefined

    if (contentType.includes("application/json")) {
      // Text-based extraction: user pasted contract description
      const body = await request.json()
      const text = body.text as string | undefined
      if (!text || !text.trim()) {
        return Response.json({ error: "No text provided" }, { status: 400 })
      }
      extractedText = text.trim()
    } else {
      // File-based extraction: user uploaded a PDF/document
      const formData = await request.formData()
      const file = formData.get("file") as File | null
      const userInstructions = (formData.get("userInstructions") as string | null)?.trim() || ""

      if (!file) {
        return Response.json({ error: "No file provided" }, { status: 400 })
      }

      const arrayBuffer = await file.arrayBuffer()
      const fileData = new Uint8Array(arrayBuffer)

      // Upload original file to S3 for archival. Don't let a missing/
      // misconfigured S3 bucket block extraction — extraction is the
      // primary value; archival is a nice-to-have.
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

      const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf")
      const mediaType = isPDF ? "application/pdf" : "text/plain"

      // Step 1: Extract text content from the document
      const extraction = await generateText({
        model: geminiModel,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Read this contract document carefully and extract ALL relevant information including:
- Contract name/title
- Vendor/manufacturer name
- Contract type (usage, capital, service, tie_in, grouped, or pricing_only)
- Effective date and expiration date (in YYYY-MM-DD format)
- Total contract value
- Any description or summary
- All rebate terms, tier structures, spend thresholds, and rebate percentages

Return all the information you find as detailed text.${userInstructions ? `\n\nAdditional user instructions:\n${userInstructions}` : ""}`,
              },
              {
                type: "file",
                data: fileData,
                mediaType,
              },
            ],
          },
        ],
      })

      extractedText = extraction.text
      if (!extractedText) {
        return Response.json({ error: "Could not read document" }, { status: 422 })
      }
    }

    // Step 2: Parse the extracted text into structured data
    const result = await generateText({
      model: geminiModel,
      output: Output.object({ schema: extractedContractSchema }),
      prompt: `Parse this contract information into structured data. Be precise with numbers and dates.

CONTRACT TYPE RULES (choose the most specific match):
- "usage" = contract has rebate tiers based on spend thresholds or volume commitments. This includes "Rebate Agreements", "Supplier-Provider Agreements", "Purchase Commitment Agreements". This is the MOST COMMON type.
- "capital" = purchase/lease of specific equipment (robots, imaging systems, etc.)
- "service" = service-level agreements, maintenance, consulting
- "tie_in" = bundled deals linking equipment purchase to supply commitments
- "grouped" = GPO/group purchasing organization contracts covering multiple vendors
- "pricing_only" = ONLY use this if the document is purely a price list with NO rebates, NO tiers, NO commitments — just catalog prices

TERM EXTRACTION RULES:
- Extract EVERY rebate tier/threshold mentioned in the document
- termType should match the actual mechanism: "spend_rebate" for spend-based, "volume_rebate" for unit-based, "market_share" for share commitments
- spendMin/spendMax are the dollar thresholds for each tier
- rebateValue is the percentage (e.g., 3.0 for 3%)
- Include the term name as written in the contract (e.g., "Qualified Annual Spend Rebate")

NUMBER RULES:
- Contract total value should be the total dollar commitment or estimated annual spend
- Tier thresholds should be exact dollar amounts from the contract
- Dates in YYYY-MM-DD format

Return valid JSON only — no markdown fences.

Contract information:
${extractedText}`,
    })

    // Output.object getter throws when the model response doesn't match the
    // Zod schema.  Catch and fall back to the raw text so we still return
    // a useful error rather than a generic 500.
    let extracted: ExtractedContractData | undefined
    try {
      extracted = result.output
    } catch {
      const rawText = result.text ?? ""
      console.error("[extract-contract] Schema validation failed. Raw AI response:", rawText.slice(0, 2000))

      // Try multiple strategies to extract valid JSON from the response
      const parseAttempts = [
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

      for (const attempt of parseAttempts) {
        try {
          const parsed = attempt()
          extracted = extractedContractSchema.parse(parsed)
          break
        } catch {
          // Try next strategy
        }
      }

      if (!extracted) {
        console.error("[extract-contract] All parse strategies failed for response:", rawText.slice(0, 500))
        return Response.json(
          { error: "Could not parse extracted data — the AI response did not match the expected format." },
          { status: 422 },
        )
      }
    }

    if (!extracted) {
      return Response.json({ error: "No data extracted" }, { status: 422 })
    }

    // Calculate confidence based on how many fields were populated
    const fieldCount = Object.keys(extracted).filter(
      (k) => extracted[k as keyof typeof extracted] !== undefined
    ).length
    const confidence = Math.min(0.95, fieldCount / 9)

    return Response.json({ extracted, confidence, s3Key })
  } catch (error) {
    console.error("Contract extraction error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"

    if (message.includes("timeout") || message.includes("DEADLINE_EXCEEDED")) {
      return Response.json(
        { error: "Document too large or complex. Try a shorter document or paste key sections as text instead." },
        { status: 422 },
      )
    }
    if (message.includes("SAFETY") || message.includes("blocked")) {
      return Response.json(
        { error: "The document could not be processed by the AI model. Try pasting the contract text manually." },
        { status: 422 },
      )
    }
    if (message.includes("not supported") || message.includes("INVALID_ARGUMENT")) {
      return Response.json(
        { error: "This file format is not supported. Please upload a standard PDF document." },
        { status: 422 },
      )
    }

    return Response.json(
      { error: `Extraction failed: ${message.slice(0, 200)}` },
      { status: 500 },
    )
  }
}
