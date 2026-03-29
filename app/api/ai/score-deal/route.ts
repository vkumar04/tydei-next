import { generateObject } from "ai"
import { geminiProModel } from "@/lib/ai/config"
import { dealScoreSchema } from "@/lib/ai/schemas"

export async function POST(request: Request) {
  try {
    const { contractData, cogData, benchmarkData } = await request.json()

    const { object } = await generateObject({
      model: geminiProModel,
      schema: dealScoreSchema,
      prompt: `Analyze this healthcare supply chain contract deal and score it across 5 dimensions (0-100 each).

Contract Data:
${JSON.stringify(contractData, null, 2)}

Cost of Goods Summary:
${JSON.stringify(cogData, null, 2)}

${benchmarkData ? `Benchmark Data:\n${JSON.stringify(benchmarkData, null, 2)}` : "No benchmark data available."}

Score each dimension considering:
- Financial Value: total savings potential, contract value relative to spend
- Rebate Efficiency: rebate structure quality, tier attainability, rebate-to-spend ratio
- Pricing Competitiveness: unit prices vs market benchmarks, discount levels
- Market Share Alignment: whether share targets are realistic and mutually beneficial
- Compliance Likelihood: how achievable the contract terms are given historical data

Provide an overall score (weighted average), a brief recommendation, and 3-5 actionable negotiation advice points.`,
    })

    return Response.json(object)
  } catch (error) {
    console.error("Deal scoring error:", error)
    return Response.json({ error: "Scoring failed" }, { status: 500 })
  }
}
