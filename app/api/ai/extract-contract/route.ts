import { generateText, generateObject } from "ai"
import { geminiModel } from "@/lib/ai/config"
import { extractedContractSchema } from "@/lib/ai/schemas"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const fileData = new Uint8Array(arrayBuffer)

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

    const extractedText = extraction.text
    if (!extractedText) {
      return Response.json({ error: "Could not read document" }, { status: 422 })
    }

    // Step 2: Parse the extracted text into structured data
    const result = await generateObject({
      model: geminiModel,
      schema: extractedContractSchema,
      prompt: `Parse this contract information into structured data. If a field is not clearly present, make your best inference from context. For dates use YYYY-MM-DD format. For contract type choose from: usage, capital, service, tie_in, grouped, pricing_only.

Contract information:
${extractedText}`,
    })

    const extracted = result.object
    if (!extracted) {
      return Response.json({ error: "No data extracted" }, { status: 422 })
    }

    // Calculate confidence based on how many fields were populated
    const fieldCount = Object.keys(extracted).filter(
      (k) => extracted[k as keyof typeof extracted] !== undefined
    ).length
    const confidence = Math.min(0.95, fieldCount / 9)

    return Response.json({ extracted, confidence })
  } catch (error) {
    console.error("Contract extraction error:", error)
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}
