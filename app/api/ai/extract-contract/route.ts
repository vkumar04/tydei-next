import { generateText, Output } from "ai"
import { geminiModel } from "@/lib/ai/config"
import { extractedContractSchema } from "@/lib/ai/schemas"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    // Convert file to Uint8Array for the AI SDK
    const arrayBuffer = await file.arrayBuffer()
    const fileData = new Uint8Array(arrayBuffer)

    const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf")
    const mediaType = isPDF ? "application/pdf" : "text/plain"

    const result = await generateText({
      model: geminiModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract structured contract data from this document.
If a field is not clearly present, make your best inference from context.
For dates, use YYYY-MM-DD format.
For contract type, choose from: usage, capital, service, tie_in, grouped, pricing_only.
Extract all terms and tier structures you can find.`,
            },
            {
              type: "file",
              data: fileData,
              mediaType,
            },
          ],
        },
      ],
      output: Output.object({ schema: extractedContractSchema }),
    })

    const extracted = result.output
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
