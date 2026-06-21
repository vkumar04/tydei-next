"use server"

/**
 * Vendor Opportunity Engine — on-demand AI insight layer.
 *
 * The deterministic engine owns the live numbers (win probability, incremental
 * revenue, net units, blended share, etc.). This action adds Claude's richer
 * read on demand: an AI win-probability estimate with risk level / competitive
 * threat / recommended action, and a recommended offer structure.
 *
 * Follows the CLAUDE.md "AI-action error path" convention exactly.
 */

import { generateText, Output } from "ai"
import { requireVendor } from "@/lib/actions/auth"
import { rateLimit } from "@/lib/rate-limit"
import { serialize } from "@/lib/serialize"
import { claudeModel } from "@/lib/ai/config"
import { recordClaudeUsage } from "@/lib/ai/record-usage"
import {
  vendorOpportunityInsightsSchema,
  type VendorOpportunityInsights,
  type VendorInsightSnapshot,
} from "@/lib/ai/analysis-insight-schemas"

const SYSTEM_PROMPT = `You are a medical-device commercial strategist advising a vendor's sales leadership on a prospective facility conversion. You will receive a deterministic deal-scenario model (price change vs current ASP, target market share, expected volume growth) and its computed outputs (win probability, incremental revenue, net unit impact, blended market share, territory recurring revenue, separated capital/robotic revenue).

Your job:
(a) a short read on the Vendor Opportunity Score drivers,
(b) an AI win-probability estimate (0-100) with risk level (Low/Medium/High), the most likely competitive threat, the single highest-leverage recommended action, and a rationale,
(c) a recommended offer structure: the concrete levers (commitment %, financing, growth rebate, technology inclusion) to reach a target conversion likelihood, with a rationale.

Rules:
- Ground every claim in the input. The deterministic model is the source of truth for the scenario economics; do not recompute its dollar figures.
- Your win-probability estimate may differ from the deterministic one, but justify the delta in the rationale.
- Capital/robotic revenue does NOT carry recurring service that hits the rep's territory number — keep that distinction.
- Format: strict JSON matching the provided schema. No prose outside the JSON.`

export async function generateVendorOpportunityInsights(
  snapshot: VendorInsightSnapshot,
): Promise<VendorOpportunityInsights> {
  const session = await requireVendor()

  const { success } = rateLimit(
    `ai-vendor-opportunity:${session.user.id}`,
    10,
    60_000,
  )
  if (!success) {
    throw new Error("Too many requests, try again shortly.")
  }

  const userMessage = `NOW: ${new Date().toISOString()}

DETERMINISTIC DEAL-SCENARIO SNAPSHOT (JSON — source of truth):
${JSON.stringify(snapshot, null, 2)}

Produce the JSON response exactly matching the schema. Explain the numbers; do not invent new dollar figures.`

  let rawOutput: unknown
  try {
    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema: vendorOpportunityInsightsSchema }),
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      maxOutputTokens: 3000,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    })
    rawOutput = result.output
  } catch (err) {
    console.error("[generateVendorOpportunityInsights]", err, {
      vendorId: session.vendor.id,
    })
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(
      `Vendor opportunity insights failed (AI request error): ${message.slice(0, 300)}`,
    )
  }

  const parsed = vendorOpportunityInsightsSchema.safeParse(rawOutput)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => {
      const path = i.path.join(".") || "(root)"
      return `${path}: ${i.message}`
    })
    console.error("[generateVendorOpportunityInsights]", parsed.error, {
      vendorId: session.vendor.id,
    })
    throw new Error(
      `Vendor opportunity insights failed (AI returned an invalid payload: ${issues.join("; ")})`,
    )
  }

  try {
    await recordClaudeUsage({
      vendorId: session.vendor.id,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? "Unknown",
      action: "ai_recommendation",
      description: "Generated vendor opportunity AI insights",
    })
  } catch (err) {
    console.error("[generateVendorOpportunityInsights] usage-record failed", err, {
      vendorId: session.vendor.id,
      userId: session.user.id,
    })
  }

  return serialize(parsed.data)
}
