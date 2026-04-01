import { generateText, Output } from "ai"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { geminiModel } from "@/lib/ai/config"
import { extractedPayorContractSchema } from "@/lib/ai/schemas"
import { uploadFile } from "@/lib/storage"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`ai-extract-payor:${session.user.id}`, 10, 60_000)
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const fileData = new Uint8Array(arrayBuffer)

    // Upload original file to S3
    const userId = session.user.id
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const s3Key = `payor-contracts/${userId}/${timestamp}-${safeName}`
    await uploadFile(s3Key, fileData, file.type || "application/octet-stream")

    const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf")
    const mediaType = isPDF ? "application/pdf" : "text/plain"

    // Step 1: Extract text content from the payor contract
    const extraction = await generateText({
      model: geminiModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Read this payor/insurance contract document carefully and extract ALL relevant information including:
- Payor/insurance carrier name
- Facility name
- Contract or agreement number
- Effective date and termination/expiration date (in YYYY-MM-DD format)
- ALL CPT code reimbursement rates (every CPT code with its dollar rate)
- ALL grouper/case-based rates (group numbers with rates)
- Implant reimbursement policies (passthrough at cost, discount percentage, maximum amounts)
- Multi-procedure payment reduction rules (primary %, secondary %, additional %)
- Any other notable contract terms

Be thorough - extract EVERY CPT code and rate you can find. Return all information as detailed text.`,
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

    const extractedText = extraction.text
    if (!extractedText) {
      return Response.json({ error: "Could not read document" }, { status: 422 })
    }

    // Step 2: Parse into structured data
    const result = await generateText({
      model: geminiModel,
      output: Output.object({ schema: extractedPayorContractSchema }),
      prompt: `Parse this payor contract information into structured data. Extract ALL CPT codes and their reimbursement rates. For dates use YYYY-MM-DD format. If a field is not clearly present, use null.

Contract information:
${extractedText}`,
    })

    const extracted = result.output
    if (!extracted) {
      return Response.json({ error: "No data extracted" }, { status: 422 })
    }

    const fieldCount = Object.keys(extracted).filter(
      (k) => extracted[k as keyof typeof extracted] !== undefined && extracted[k as keyof typeof extracted] !== null
    ).length
    const confidence = Math.min(0.95, fieldCount / 10)

    return Response.json({ extracted, confidence, s3Key })
  } catch (error) {
    console.error("Payor contract extraction error:", error)
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}
