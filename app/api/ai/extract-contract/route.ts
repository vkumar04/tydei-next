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

      if (!file) {
        return Response.json({ error: "No file provided" }, { status: 400 })
      }

      const arrayBuffer = await file.arrayBuffer()
      const fileData = new Uint8Array(arrayBuffer)

      // Upload original file to S3 for archival
      const userId = session.user.id
      const timestamp = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      s3Key = `contracts/${userId}/${timestamp}-${safeName}`
      await uploadFile(s3Key, fileData, file.type || "application/octet-stream")

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

Return all the information you find as detailed text.`,
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
      prompt: `Parse this contract information into structured data. If a field is not clearly present, make your best inference from context. For dates use YYYY-MM-DD format. For contract type choose from: usage, capital, service, tie_in, grouped, pricing_only.

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
      // Schema validation failed — try manual parse from result text
      try {
        const cleaned = (result.text ?? "")
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim()
        extracted = extractedContractSchema.parse(JSON.parse(cleaned))
      } catch {
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
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}
