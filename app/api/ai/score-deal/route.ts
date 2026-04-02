import { generateText, Output } from "ai"
import { z } from "zod"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { geminiModel } from "@/lib/ai/config"
import { dealScoreSchema } from "@/lib/ai/schemas"
import { rateLimit } from "@/lib/rate-limit"

const scoreBodySchema = z.object({
  contractData: z.record(z.string(), z.unknown()),
  cogData: z.record(z.string(), z.unknown()),
  benchmarkData: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`ai-score:${session.user.id}`, 10, 60_000)
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const parsed = scoreBodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body" }, { status: 400 })
    }
    const { contractData, cogData, benchmarkData } = parsed.data

    const result = await generateText({
      model: geminiModel,
      output: Output.object({ schema: dealScoreSchema }),
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

    return Response.json(result.output)
  } catch (error) {
    console.error("Deal scoring error:", error)
    return Response.json({ error: "Scoring failed" }, { status: 500 })
  }
}
