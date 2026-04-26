import { generateText } from "ai"
import {
  generateStructured,
  withCacheControl,
} from "@/lib/ai/generate-structured"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { claudeModel } from "@/lib/ai/config"
import { extractedPayorContractSchema, type ExtractedPayorContractData } from "@/lib/ai/schemas"
import { uploadFile } from "@/lib/storage"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

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
      model: claudeModel,
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
              ...withCacheControl(),
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
    const result = await generateStructured({
      schema: extractedPayorContractSchema,
      actionName: "extract-payor-contract",
      messages: [
        {
          role: "user",
          content: `Parse this payor contract information into structured data. Extract ALL CPT codes and their reimbursement rates. For dates use YYYY-MM-DD format. If a field is not clearly present, use null.

Return valid JSON only — no markdown fences.

Contract information:
${extractedText}`,
        },
      ],
    })

    let extracted: ExtractedPayorContractData | undefined
    try {
      extracted = result.output
    } catch {
      try {
        const cleaned = (result.text ?? "")
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim()
        extracted = extractedPayorContractSchema.parse(JSON.parse(cleaned))
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

    const fieldCount = Object.keys(extracted).filter(
      (k) => extracted[k as keyof typeof extracted] !== undefined && extracted[k as keyof typeof extracted] !== null
    ).length
    const confidence = Math.min(0.95, fieldCount / 10)

    try {
      const member = await prisma.member.findFirst({
        where: { userId: session.user.id },
        include: {
          organization: { include: { facility: true, vendor: true } },
        },
      })
      await recordClaudeUsage({
        facilityId: member?.organization?.facility?.id ?? null,
        vendorId: member?.organization?.vendor?.id ?? null,
        userId: session.user.id,
        userName: session.user.name ?? session.user.email ?? "Unknown",
        action: "full_contract_analysis",
        description: `Extracted payor contract from ${file.name.slice(0, 40)}`,
      })
    } catch (err) {
      console.error("[extract-payor-contract] usage-record failed", err, {
        userId: session.user.id,
      })
    }

    return Response.json({ extracted, confidence, s3Key })
  } catch (error) {
    console.error("Payor contract extraction error:", error)
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}
