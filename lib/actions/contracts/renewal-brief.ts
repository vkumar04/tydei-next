"use server"

/**
 * Renewal Brief — AI-generated negotiation primer (Tier 4).
 *
 * Flow:
 *   1. `requireFacility()` — gate the caller, scope the contract read.
 *   2. Load contract + terms + tiers + all Rebate rows + ContractPeriod
 *      rollups + ContractChangeProposal history via `contractOwnershipWhere`
 *      (single-contract ownership predicate).
 *   3. Normalize into `RenewalBriefInput`, hash canonical JSON → 1-hour
 *      cache lookup on `RenewalBriefCache`.
 *   4. On miss: call Claude Opus 4.6 via the Vercel AI SDK (same pattern as
 *      Wave 1's `rebate-optimizer-insights`). System prompt marked
 *      `cacheControl: ephemeral` for prompt caching. 12K max output tokens.
 *   5. Validate against `renewalBriefSchema`, persist cache row, return.
 *
 * Spec: docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md §4.2
 * Plan: docs/superpowers/plans/2026-04-19-rebate-optimizer-ai-implementation.md §2
 *
 * Reference implementation: `lib/actions/rebate-optimizer-insights.ts` (Wave 1).
 */

import { createHash } from "node:crypto"
import { generateText, Output } from "ai"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { claudeModel } from "@/lib/ai/config"
import {
  renewalBriefSchema,
  type RenewalBrief,
  type RenewalBriefInput,
} from "@/lib/ai/renewal-brief-schemas"

const MODEL_ID = "claude-opus-4-6"
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const MAX_OUTPUT_TOKENS = 12000

const SYSTEM_PROMPT = `You are a contract-renewal advisor for medical facility procurement teams.
You will receive a contract with its terms, tiers, full earned-rebate history, period rollups, and amendment history.

Your job: produce a 1-page negotiation primer with:
(a) a 2-sentence executive summary,
(b) a performance summary quantifying capture rate + any missed tiers by quarter,
(c) 3-6 ranked primary asks each with rationale + quantified impact when derivable,
(d) 2-4 concessions the facility could offer in return.

Rules:
- Every number you emit must be derivable from the input — do not invent numbers. If uncertain, leave quantifiedImpact / estimatedCost null.
- Quarters in missedTiers should use a compact label like "2025-Q2".
- captureRate is earned rebate / maximum-possible rebate, expressed as a 0-1 fraction.
- tierValue units: tier rebateValue is stored as a fraction (e.g., 0.02 = 2%). Interpret accordingly.
- Rank primary asks so rank 1 has the highest expected value.
- Keep the executive summary to 2-3 sentences.
- Keep the rationale for each ask to 2-4 sentences with specific historical citations (quarters, tier numbers, dollar figures).

Format: strict JSON matching the provided schema. Do not emit prose outside the JSON.`

/**
 * Generate (or fetch from cache) an AI-authored renewal brief for the given
 * contract. 1-hour cache keyed by SHA-256(canonical(input)). Pass
 * `forceFresh` to bypass.
 */
export async function generateRenewalBrief(
  contractId: string,
  opts?: { forceFresh?: boolean },
): Promise<RenewalBrief> {
  const session = await requireFacility()

  // ── 1. Load contract + all the history Claude needs ────────────────
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, session.facility.id),
    include: {
      vendor: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
      },
      rebates: {
        orderBy: { payPeriodStart: "asc" },
      },
      periods: {
        orderBy: { periodStart: "asc" },
      },
      changeProposals: {
        orderBy: { submittedAt: "asc" },
      },
    },
  })
  if (!contract) {
    throw new Error("Contract not found or not owned by this facility")
  }

  // Guard: a contract with no terms has nothing for the model to analyze.
  // Return a safe fallback synchronous brief rather than spending a round
  // trip just to have Claude say "no data". The UI still renders.
  if (contract.terms.length === 0) {
    const now = new Date()
    return serialize<RenewalBrief>({
      contractId: contract.id,
      generatedAt: now.toISOString(),
      executiveSummary:
        "No rebate terms are defined on this contract, so there are no missed tiers or capture-rate history to analyze. Define at least one term (with tiers) before requesting a renewal brief.",
      performanceSummary: {
        termMonths: Math.max(
          0,
          Math.round(
            (contract.expirationDate.getTime() -
              contract.effectiveDate.getTime()) /
              (1000 * 60 * 60 * 24 * 30),
          ),
        ),
        totalSpend: 0,
        projectedFullSpend: 0,
        captureRate: 0,
        missedTiers: [],
      },
      primaryAsks: [],
      concessionsOnTable: [],
    })
  }

  // ── 2. Normalize input for hashing + the prompt ────────────────────
  const input: RenewalBriefInput = {
    contract: {
      id: contract.id,
      name: contract.name,
      contractNumber: contract.contractNumber ?? null,
      vendorId: contract.vendorId,
      vendorName: contract.vendor.name,
      effectiveDate: contract.effectiveDate.toISOString(),
      expirationDate: contract.expirationDate.toISOString(),
      totalValue: Number(contract.totalValue ?? 0),
      annualValue: Number(contract.annualValue ?? 0),
      performancePeriod: String(contract.performancePeriod),
      rebatePayPeriod: String(contract.rebatePayPeriod),
      autoRenewal: Boolean(contract.autoRenewal),
    },
    terms: contract.terms.map((t) => ({
      id: t.id,
      termName: t.termName,
      termType: String(t.termType),
      baselineType: String(t.baselineType),
      rebateMethod: String(t.rebateMethod),
      effectiveStart: t.effectiveStart.toISOString(),
      effectiveEnd: t.effectiveEnd.toISOString(),
      spendBaseline:
        t.spendBaseline != null ? Number(t.spendBaseline) : null,
      tiers: t.tiers.map((tier) => ({
        tierNumber: tier.tierNumber,
        tierName: tier.tierName ?? null,
        spendMin: Number(tier.spendMin ?? 0),
        spendMax: tier.spendMax != null ? Number(tier.spendMax) : null,
        rebateType: String(tier.rebateType),
        rebateValue: Number(tier.rebateValue ?? 0),
      })),
    })),
    rebateHistory: contract.rebates.map((r) => ({
      id: r.id,
      periodId: r.periodId ?? null,
      rebateEarned: Number(r.rebateEarned ?? 0),
      rebateCollected: Number(r.rebateCollected ?? 0),
      payPeriodStart: r.payPeriodStart.toISOString(),
      payPeriodEnd: r.payPeriodEnd.toISOString(),
      collectionDate: r.collectionDate
        ? r.collectionDate.toISOString()
        : null,
    })),
    periodHistory: contract.periods.map((p) => ({
      id: p.id,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      totalSpend: Number(p.totalSpend ?? 0),
      rebateEarned: Number(p.rebateEarned ?? 0),
      rebateCollected: Number(p.rebateCollected ?? 0),
      tierAchieved: p.tierAchieved ?? null,
    })),
    amendmentHistory: contract.changeProposals.map((cp) => ({
      id: cp.id,
      proposalType: String(cp.proposalType),
      status: String(cp.status),
      submittedAt: cp.submittedAt.toISOString(),
      reviewedAt: cp.reviewedAt ? cp.reviewedAt.toISOString() : null,
      vendorMessage: cp.vendorMessage ?? null,
    })),
  }

  const inputHash = hashInput(input)

  // ── 3. Cache lookup ────────────────────────────────────────────────
  if (!opts?.forceFresh) {
    const cached = await prisma.renewalBriefCache.findFirst({
      where: {
        contractId,
        inputHash,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    })
    if (cached) {
      const parsed = renewalBriefSchema.safeParse(cached.response)
      if (parsed.success) return serialize(parsed.data)
      // Fall through to a fresh call if the cached payload drifted.
    }
  }

  // ── 4. Call Claude ─────────────────────────────────────────────────
  const userMessage = `CONTRACT_ID: ${contractId}
NOW: ${new Date().toISOString()}

INPUT CONTEXT (JSON):
${JSON.stringify(input, null, 2)}

Produce the JSON response exactly matching the schema. Use the rebateHistory + periodHistory to compute capture rate and missed tiers. Cite specific quarters where possible. Do not invent numbers.`

  let response: RenewalBrief
  let rawOutput: unknown
  try {
    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema: renewalBriefSchema }),
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: {
        anthropic: {
          // Prompt caching — the system prompt is static and large enough
          // to be worth caching. Adaptive thinking is Opus 4.6's default.
          cacheControl: { type: "ephemeral" },
        },
      },
    })
    rawOutput = result.output
  } catch (err) {
    // Anthropic API call itself failed (schema rejected, rate-limit, auth,
    // context exceeded, etc.). Surface the message — not the stack — so the
    // toast is readable.
    // Per CLAUDE.md "AI-action error path": log the raw exception server-side
    // before re-throwing, so prod digests still have a debug trail.
    console.error("[generateRenewalBrief]", err, {
      facilityId: session.facility.id,
      contractId,
    })
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(
      `Renewal brief generation failed (AI request error): ${message.slice(0, 300)}`,
    )
  }

  const parsed = renewalBriefSchema.safeParse(rawOutput)
  if (!parsed.success) {
    // Claude returned a payload that doesn't match our schema. Flatten the
    // first few issue paths so the UI can surface something actionable.
    const issues = parsed.error.issues.slice(0, 3).map((i) => {
      const path = i.path.join(".") || "(root)"
      return `${path}: ${i.message}`
    })
    // Log the full Zod error server-side — the toast only gets the first few
    // paths, but the server log sees everything.
    console.error("[generateRenewalBrief]", parsed.error, {
      facilityId: session.facility.id,
      contractId,
    })
    throw new Error(
      `Renewal brief generation failed (AI returned an invalid payload: ${issues.join("; ")})`,
    )
  }
  response = parsed.data

  // ── 5. Persist cache row + return ──────────────────────────────────
  const now = new Date()
  await prisma.renewalBriefCache.create({
    data: {
      contractId,
      inputHash,
      response: response as unknown as object,
      model: MODEL_ID,
      expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
    },
  })

  return serialize(response)
}

// ─── Helpers ─────────────────────────────────────────────────────────

function hashInput(input: RenewalBriefInput): string {
  const canonical = canonicalJson(input)
  return createHash("sha256").update(canonical).digest("hex")
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`
}
