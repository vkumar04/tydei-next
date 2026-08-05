"use server"

/**
 * Facility Analysis dashboard — on-demand AI insight layer.
 *
 * The deterministic engines own every NUMBER on the page (they recalc live on
 * every slider drag). This action adds the narrative/recommendation layer on
 * demand: it receives the current deterministic snapshot + re-derives the
 * facility's real category/vendor data for grounding, and asks Claude to
 * explain the opportunity, recommend conversion targets, predict managed-care
 * reimbursement, and read the enterprise-value impact.
 *
 * Follows the CLAUDE.md "AI-action error path" convention exactly.
 */

import { generateText, Output } from "ai"
import { requireFacility } from "@/lib/actions/auth"
import { rateLimit } from "@/lib/rate-limit"
import { serialize } from "@/lib/serialize"
import { claudeModel } from "@/lib/ai/config"
import { recordClaudeUsage } from "@/lib/ai/record-usage"
import {
  getFacilityAnalysisData,
  type AnalysisDataScope,
} from "@/lib/actions/facility-analysis-data"
import {
  facilityAnalysisInsightsSchema,
  type FacilityAnalysisInsights,
  type FacilityInsightSnapshot,
} from "@/lib/ai/analysis-insight-schemas"

const SYSTEM_PROMPT = `You are a healthcare-finance advisor for ambulatory surgery centers and hospital procurement teams. You will receive a facility's real spend/revenue data plus a deterministic financial model (EBITDA, distributable cash flow, enterprise value, and the modeled impact of a negotiated supply saving).

Your job: produce a CFO-grade read of the opportunity —
(a) a 2-3 sentence executive summary,
(b) a read on what is driving the Contract Opportunity Score and its weak dimensions,
(c) recommended conversion targets (which categories to convert first and why),
(d) a managed-care reimbursement prediction as a % of the Medicare equivalent, with a short rationale,
(e) a plain-language read on the enterprise-value impact.

Rules:
- Do NOT invent numbers. Every figure you cite must be derivable from the input. The deterministic model is the source of truth — explain and contextualize it, do not recompute it.
- For the managed-care range, you may refine the provided deterministic band using the case-mix/volume signal, but stay within a defensible, conservative range.
- Be specific and concrete. Reference the real category and vendor names from the input.
- Format: strict JSON matching the provided schema. No prose outside the JSON.`

export async function generateFacilityAnalysisInsights(
  snapshot: FacilityInsightSnapshot,
  scope?: AnalysisDataScope,
): Promise<FacilityAnalysisInsights> {
  const session = await requireFacility()

  const { success } = rateLimit(
    `ai-facility-analysis:${session.user.id}`,
    10,
    60_000,
  )
  if (!success) {
    throw new Error("Too many requests, try again shortly.")
  }

  // Re-derive the real DB breakdown for grounding (category + vendor names) —
  // under the SAME scope the dashboard snapshot was built from, so the
  // grounding names match the numbers the model is explaining.
  const data = await getFacilityAnalysisData(scope)

  const userMessage = `NOW: ${new Date().toISOString()}
FACILITY_HAS_DATA: ${data.hasData}
REVENUE_IS_IMPLIED: ${snapshot.revenueIsImplied}

DETERMINISTIC MODEL SNAPSHOT (JSON — source of truth):
${JSON.stringify(snapshot, null, 2)}

REAL FACILITY BREAKDOWN (JSON — for grounding category/vendor names):
${JSON.stringify(
  {
    categories: data.categories,
    vendors: data.vendors,
    avgMarginPct: data.avgMarginPct,
    topVendorConcentrationPct: data.topVendorConcentrationPct,
  },
  null,
  2,
)}

Produce the JSON response exactly matching the schema. Explain the numbers; do not invent new ones.`

  let rawOutput: unknown
  try {
    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema: facilityAnalysisInsightsSchema }),
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      maxOutputTokens: 4000,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    })
    rawOutput = result.output
  } catch (err) {
    console.error("[generateFacilityAnalysisInsights]", err, {
      facilityId: session.facility.id,
    })
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(
      `Facility analysis insights failed (AI request error): ${message.slice(0, 300)}`,
    )
  }

  const parsed = facilityAnalysisInsightsSchema.safeParse(rawOutput)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => {
      const path = i.path.join(".") || "(root)"
      return `${path}: ${i.message}`
    })
    console.error("[generateFacilityAnalysisInsights]", parsed.error, {
      facilityId: session.facility.id,
    })
    throw new Error(
      `Facility analysis insights failed (AI returned an invalid payload: ${issues.join("; ")})`,
    )
  }

  try {
    await recordClaudeUsage({
      facilityId: session.facility.id,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? "Unknown",
      action: "ai_recommendation",
      description: "Generated facility analysis AI insights",
    })
  } catch (err) {
    console.error("[generateFacilityAnalysisInsights] usage-record failed", err, {
      facilityId: session.facility.id,
      userId: session.user.id,
    })
  }

  return serialize(parsed.data)
}
