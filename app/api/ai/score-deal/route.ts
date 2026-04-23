import { generateText, Output } from "ai"
import { z } from "zod"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { claudeModel } from "@/lib/ai/config"
import { dealScoreSchema, type DealScoreResult } from "@/lib/ai/schemas"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

const scoreBodySchema = z.object({
  contractData: z.record(z.string(), z.unknown()),
  cogData: z.record(z.string(), z.unknown()),
  benchmarkData: z.record(z.string(), z.unknown()).optional(),
})

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))
}

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
      model: claudeModel,
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

    const score: DealScoreResult = result.output
    const clamped: DealScoreResult = {
      ...score,
      financialValue: clamp01to100(score.financialValue),
      rebateEfficiency: clamp01to100(score.rebateEfficiency),
      pricingCompetitiveness: clamp01to100(score.pricingCompetitiveness),
      marketShareAlignment: clamp01to100(score.marketShareAlignment),
      complianceLikelihood: clamp01to100(score.complianceLikelihood),
      overallScore: clamp01to100(score.overallScore),
    }
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
        action: "ai_recommendation",
        description: `Scored contract deal (overall ${clamped.overallScore})`,
      })
    } catch (err) {
      console.error("[score-deal] usage-record failed", err, {
        userId: session.user.id,
      })
    }

    return Response.json(clamped)
  } catch (error) {
    console.error("Deal scoring error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json(
      {
        error: "Scoring failed",
        details: process.env.NODE_ENV === "production" ? undefined : message,
      },
      { status: 500 }
    )
  }
}
