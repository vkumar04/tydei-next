import { generateText, Output } from "ai"
import { geminiModel } from "@/lib/ai/config"
import { supplyMatchSchema } from "@/lib/ai/schemas"

export async function POST(request: Request) {
  try {
    const { supplyName, vendorItemNo, contractPricing } = await request.json()

    const pricingContext = contractPricing
      .slice(0, 50)
      .map(
        (p: { vendorItemNo: string; description?: string; unitPrice: number }) =>
          `${p.vendorItemNo} — ${p.description ?? "N/A"} ($${p.unitPrice})`
      )
      .join("\n")

    const result = await generateText({
      model: geminiModel,
      output: Output.object({ schema: supplyMatchSchema }),
      prompt: `Match this surgical supply to the closest item in the contract pricing list.

Supply to match:
- Material Name: ${supplyName}
- Vendor Item No: ${vendorItemNo ?? "Unknown"}

Contract Pricing Items:
${pricingContext}

If no reasonable match exists (confidence < 0.3), return null for matchedVendorItemNo and matchedDescription.
Explain your reasoning for the match or lack thereof.`,
    })

    return Response.json(result.output)
  } catch (error) {
    console.error("Supply matching error:", error)
    return Response.json({ error: "Matching failed" }, { status: 500 })
  }
}
