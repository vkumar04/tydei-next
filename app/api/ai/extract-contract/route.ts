import { generateObject } from "ai"
import { geminiModel } from "@/lib/ai/config"
import { extractedContractSchema } from "@/lib/ai/schemas"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const text = new TextDecoder().decode(buffer)

    const { object } = await generateObject({
      model: geminiModel,
      schema: extractedContractSchema,
      prompt: `Extract structured contract data from the following PDF text content.
If a field is not clearly present, make your best inference from context.
For dates, use YYYY-MM-DD format.
For contract type, choose the closest match from: usage, capital, service, tie_in, grouped, pricing_only.

PDF Content:
${text.slice(0, 15000)}`,
    })

    const fieldCount = Object.keys(object).filter(
      (k) => object[k as keyof typeof object] !== undefined
    ).length
    const confidence = Math.min(0.95, fieldCount / 9)

    return Response.json({ extracted: object, confidence })
  } catch (error) {
    console.error("Contract extraction error:", error)
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}
