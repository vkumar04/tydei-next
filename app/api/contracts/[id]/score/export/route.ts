/**
 * Contract AI score recommendations CSV export — Charles R5.15.
 *
 * Recomputes the AI deal score server-side and emits one CSV row per
 * recommendation (severity, category, title, rationale). Sharing
 * `lib/contracts/score-recommendations.ts` with the score page ensures
 * the downloaded artifact matches what the user sees.
 *
 * Auth: `auth.api.getSession` + facility membership check, mirroring
 * `app/api/cog/export/route.ts` so an operator cannot pull another
 * facility's contract.
 */

import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { generateText, Output } from "ai"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import { claudeModel } from "@/lib/ai/config"
import { dealScoreSchema, type DealScoreResult } from "@/lib/ai/schemas"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  buildDimensions,
  buildRecommendations,
  buildRecommendationsCSV,
} from "@/lib/contracts/score-recommendations"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const session = await auth.api.getSession({ headers: await getHeaders() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true } } },
  })
  const facility = member?.organization?.facility
  if (!facility) {
    return NextResponse.json(
      { error: "Facility session required" },
      { status: 403 }
    )
  }

  // Facility-scoped ownership check — P2025 bubbles up as 404.
  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(id, facility.id),
    include: {
      vendor: { select: { name: true } },
      terms: { include: { tiers: true } },
    },
  })
  if (!contract) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const contractData = {
    name: contract.name,
    type: contract.contractType,
    totalValue: Number(contract.totalValue ?? 0),
    annualValue: Number(contract.annualValue ?? 0),
    vendor: contract.vendor.name,
    termsCount: contract.terms.length,
    tiersCount: contract.terms.reduce((sum, t) => sum + t.tiers.length, 0),
  }

  let aiScore: DealScoreResult
  try {
    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema: dealScoreSchema }),
      prompt: `Analyze this healthcare supply chain contract deal and score it across 5 dimensions (0-100 each).

Contract Data:
${JSON.stringify(contractData, null, 2)}

Cost of Goods Summary:
{}

Score each dimension considering:
- Financial Value
- Rebate Efficiency
- Pricing Competitiveness
- Market Share Alignment
- Compliance Likelihood

Provide an overall score, a brief recommendation, and 3-5 negotiation advice points.`,
    })
    const s = result.output
    aiScore = {
      ...s,
      financialValue: clamp01to100(s.financialValue),
      rebateEfficiency: clamp01to100(s.rebateEfficiency),
      pricingCompetitiveness: clamp01to100(s.pricingCompetitiveness),
      marketShareAlignment: clamp01to100(s.marketShareAlignment),
      complianceLikelihood: clamp01to100(s.complianceLikelihood),
      overallScore: clamp01to100(s.overallScore),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      { error: "Scoring failed", details: message },
      { status: 502 }
    )
  }

  try {
    await recordClaudeUsage({
      facilityId: facility.id,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? "Unknown",
      action: "ai_recommendation",
      description: `Scored contract ${contract.name.slice(0, 40)} for export`,
    })
  } catch (err) {
    console.error("[score/export] usage-record failed", err, {
      facilityId: facility.id,
      userId: session.user.id,
    })
  }

  const dims = buildDimensions(aiScore)
  const recs = buildRecommendations(
    dims,
    aiScore.recommendation,
    aiScore.negotiationAdvice
  )
  const csv = buildRecommendationsCSV(recs)
  const filename = `contract-${id}-ai-recommendations-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
