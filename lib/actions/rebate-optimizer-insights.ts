"use server"

/**
 * Rebate Optimizer — AI Smart Recommendations server action (Tier 1).
 *
 * Orchestrates:
 *   1. Loading ranked opportunities + rule-based alerts from the existing
 *      engine (`lib/actions/rebate-optimizer-engine.ts`).
 *   2. Loading last-90-days per-vendor spend from COG.
 *   3. Hashing the resulting context → 15-minute cache lookup on
 *      `RebateInsightCache`.
 *   4. On miss: calling Claude via the Vercel AI SDK (`generateText` with
 *      `Output.object` — the SDK's equivalent of `messages.parse` against a
 *      Zod schema). The system prompt is marked `cacheControl: ephemeral` for
 *      ~80% token-cost reduction on regenerations.
 *   5. Validating + serializing + writing the cache row.
 *
 * Also exposes `flagRebateInsight` / `listRebateInsightFlags` /
 * `clearRebateInsightFlag` for the "Flag for review" follow-ups feed.
 *
 * Spec: docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md §4.1
 * Plan: docs/superpowers/plans/2026-04-19-rebate-optimizer-ai-implementation.md §1.3
 *
 * Note on SDK choice: this file uses `@ai-sdk/anthropic` (Vercel AI SDK's
 * Anthropic adapter — the provider already wired up project-wide in
 * `lib/ai/config.ts`). The plan references `@anthropic-ai/sdk`'s
 * `messages.stream` + `messages.parse`; the equivalent in the Vercel AI SDK
 * is `generateText` + `Output.object({ schema })`, which this file uses.
 */

import { createHash } from "node:crypto"
import { generateText, Output } from "ai"
import { requireFacility } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { claudeModel } from "@/lib/ai/config"
import { recordClaudeUsage } from "@/lib/ai/record-usage"
import { getRebateOpportunities as getRebateOpportunitiesEngine } from "@/lib/actions/rebate-optimizer-engine"
import {
  rebateInsightSchema,
  rebateInsightsResponseSchema,
  type RebateInsight,
  type RebateInsightsInput,
  type RebateInsightsResponse,
} from "@/lib/ai/rebate-optimizer-schemas"

const MODEL_ID = "claude-opus-4-6"
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_OUTPUT_TOKENS = 8000
const LAST_N_DAYS = 90

const SYSTEM_PROMPT = `You are a rebate-optimization advisor for medical facility contract managers.
You will receive:
- opportunities: ranked list of contract tier gaps with projected rebate uplift (currentSpend, nextTierThreshold, additionalRebate, daysRemaining)
- alerts: rule-based tier-threshold alerts (at/approaching/missed/achieved)
- recentSpend: last 90 days of per-vendor COG spend, aggregated by vendorId

Your job: produce 3-6 actionable recommendations ranked by ROI x confidence.
Rules:
- Every recommendation MUST cite at least one contractId from the input opportunities list.
- Every dollar figure you state must be derivable from the input data — do not invent numbers. If uncertain, say so and drop confidence to "low".
- Prefer recommendations that combine portfolio signals (e.g., redirect spend from an over-performing contract to an under-performing one).
- Keep the title under 80 characters. The summary is 1-2 sentences. The rationale is 3-6 sentences.
- Choose actionType from: redirect_spend, accelerate_purchase, negotiate_tier, log_collection, review_compliance.
- Emit a stable kebab-case id for each insight (e.g., "redirect-stryker-to-depuy-q4").
- Rank 1 is the most actionable; rank sequentially with no gaps.

Format: strict JSON matching the provided schema. Do not emit prose outside the JSON.`

/**
 * Get (or compute) AI-generated Smart Recommendations for the caller's facility.
 * 15-minute cache keyed by a SHA-256 hash of (opportunities + alerts + spend).
 * Pass `forceFresh` to bypass the cache.
 */
export async function getRebateOptimizerInsights(
  facilityId: string,
  opts?: { forceFresh?: boolean },
): Promise<RebateInsightsResponse> {
  const session = await requireFacility()
  if (session.facility.id !== facilityId) {
    throw new Error("Facility mismatch: cannot request insights for another facility")
  }

  // ── 1. Load engine opportunities + rule-based alerts ───────────────
  const engineResult = await getRebateOpportunitiesEngine()

  // ── 2. Last 90-day vendor spend from COG ───────────────────────────
  // Charles 2026-04-24 (Bug 2): floor `since` to a UTC day boundary so
  // every call within the same UTC day sees an identical window. Without
  // this the window slides by milliseconds per call, flipping the spend
  // aggregate the moment any COG row crosses the boundary → hash miss →
  // fresh non-deterministic Claude call, which reads to the user as
  // "numbers keep changing."
  const sinceMs = Date.now() - LAST_N_DAYS * 24 * 60 * 60 * 1000
  const since = new Date(Math.floor(sinceMs / 86_400_000) * 86_400_000)
  const spendRows = await prisma.cOGRecord.groupBy({
    by: ["vendorId"],
    where: {
      facilityId,
      vendorId: { not: null },
      transactionDate: { gte: since },
    },
    _sum: { extendedPrice: true },
  })
  const vendorIds = spendRows
    .map((r) => r.vendorId)
    .filter((v): v is string => Boolean(v))
  const vendorsById = new Map<string, string>()
  if (vendorIds.length > 0) {
    const vendors = await prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, name: true },
    })
    for (const v of vendors) vendorsById.set(v.id, v.name)
  }
  const recentSpend = spendRows
    .filter((r): r is typeof r & { vendorId: string } => Boolean(r.vendorId))
    .map((r) => ({
      vendorId: r.vendorId,
      vendorName: vendorsById.get(r.vendorId) ?? "Unknown",
      last90DaysSpend: Number(r._sum.extendedPrice ?? 0),
    }))

  // ── 3. Build normalized input → hash → cache lookup ────────────────
  const input: RebateInsightsInput = {
    facilityId,
    opportunities: engineResult.opportunities.map((o) => ({
      contractId: o.contractId,
      contractName: o.contractName,
      vendorId: o.vendorId ?? null,
      vendorName: o.vendorName,
      currentSpend: o.currentSpend,
      currentTierNumber: o.currentTierNumber ?? null,
      nextTierNumber: o.nextTierNumber,
      nextTierThreshold: o.nextTierThreshold,
      additionalRebate: o.additionalRebate,
      daysRemaining: o.daysRemaining ?? null,
    })),
    alerts: engineResult.rankedAlerts.map((a) => ({
      id: `${a.kind}:${a.contractId}`,
      kind: a.kind,
      title: a.title,
      message: a.message,
      contractId: a.contractId,
      impactDollars: a.valueReference,
    })),
    recentSpend,
  }

  // Charles 2026-04-24 (Bug 2): hash a time-bucketed projection of the
  // input so `daysRemaining` (decrements daily) doesn't flip the cache
  // every midnight. We keep the true per-day value in the prompt sent to
  // Claude (so the model reasons on current truth) but collapse it into
  // weekly buckets for the cache key. Result: within a 7-day window, the
  // same opportunity mix hashes identically → one Claude call, stable
  // output.
  const inputHash = hashInput(bucketForHash(input))

  if (!opts?.forceFresh) {
    const cached = await prisma.rebateInsightCache.findFirst({
      where: {
        facilityId,
        inputHash,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    })
    if (cached) {
      const parsed = rebateInsightsResponseSchema.safeParse(cached.response)
      if (parsed.success) return serialize(parsed.data)
      // Fall through to a fresh call if the cached payload somehow drifted.
    }
  }

  // ── 4. Call Claude ─────────────────────────────────────────────────
  const userMessage = `FACILITY: ${facilityId}
NOW: ${new Date().toISOString()}

INPUT CONTEXT (JSON):
${JSON.stringify(input, null, 2)}

Produce the JSON response exactly matching the schema. Include observations only if there is a portfolio-level note worth surfacing beyond the ranked insights.`

  let response: RebateInsightsResponse
  try {
    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema: rebateInsightsResponseSchema }),
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Charles 2026-04-24 (Bug 2): temperature 0 so regenerations that
      // DO miss the cache still produce the same ranking/prose for the
      // same input. Without it, two mounts within the 15-minute cache
      // window could race to insert and return different rows.
      temperature: 0,
      providerOptions: {
        anthropic: {
          // Prompt caching — tag the (large, static) system prompt so repeat
          // calls within ~5 minutes reuse the cached prefix. Adaptive thinking
          // is set on the model side by default for Opus 4.6.
          cacheControl: { type: "ephemeral" },
        },
      },
    })
    const raw = result.output
    response = rebateInsightsResponseSchema.parse(raw)
  } catch (err) {
    // Per CLAUDE.md "AI-action error path": log the raw exception server-side
    // so prod digests still have a debug trail. Client only sees the sliced
    // message below.
    console.error("[getRebateOptimizerInsights]", err, {
      facilityId,
    })
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(`AI Smart Recommendations generation failed: ${message.slice(0, 300)}`)
  }

  // Record usage — only reached on cache MISS, so we don't double-bill.
  try {
    await recordClaudeUsage({
      facilityId,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? "Unknown",
      action: "ai_recommendation",
      description: "Generated rebate optimizer insights",
    })
  } catch (err) {
    console.error("[getRebateOptimizerInsights] usage-record failed", err, {
      facilityId,
      userId: session.user.id,
    })
  }

  // ── 5. Persist cache row + return ──────────────────────────────────
  const now = new Date()
  await prisma.rebateInsightCache.create({
    data: {
      facilityId,
      inputHash,
      response: response as unknown as object,
      model: MODEL_ID,
      expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
    },
  })

  return serialize(response)
}

/**
 * Record a user's "flag for review" click on an insight. The snapshot is
 * persisted so the follow-ups feed survives future AI regenerations.
 */
export async function flagRebateInsight(input: {
  insightId: string
  snapshot: RebateInsight
}): Promise<{ id: string }> {
  const session = await requireFacility()

  const snapshot = rebateInsightSchema.parse(input.snapshot)

  const row = await prisma.rebateInsightFlag.create({
    data: {
      facilityId: session.facility.id,
      insightId: input.insightId,
      title: snapshot.title,
      summary: snapshot.summary,
      snapshot: snapshot as unknown as object,
      flaggedBy: session.user.id,
    },
  })

  return { id: row.id }
}

export interface RebateInsightFlagRow {
  id: string
  insightId: string
  title: string
  summary: string
  snapshot: RebateInsight
  flaggedBy: string
  createdAt: string
}

/** List flagged insights for the caller's facility, newest first. */
export async function listRebateInsightFlags(
  facilityId: string,
): Promise<RebateInsightFlagRow[]> {
  const session = await requireFacility()
  if (session.facility.id !== facilityId) {
    throw new Error("Facility mismatch: cannot list flags for another facility")
  }

  const rows = await prisma.rebateInsightFlag.findMany({
    where: { facilityId },
    orderBy: { createdAt: "desc" },
  })

  return rows.map((r) => {
    const parsed = rebateInsightSchema.safeParse(r.snapshot)
    const snapshot: RebateInsight = parsed.success
      ? parsed.data
      : {
          id: r.insightId,
          rank: 1,
          title: r.title,
          summary: r.summary,
          rationale: "",
          impactDollars: null,
          confidence: "low",
          actionType: "review_compliance",
          citedContractIds: [],
        }
    return {
      id: r.id,
      insightId: r.insightId,
      title: r.title,
      summary: r.summary,
      snapshot,
      flaggedBy: r.flaggedBy,
      createdAt: r.createdAt.toISOString(),
    }
  })
}

/** Remove a flagged insight. Scoped to the caller's facility. */
export async function clearRebateInsightFlag(id: string): Promise<void> {
  const session = await requireFacility()
  await prisma.rebateInsightFlag.deleteMany({
    where: {
      id,
      facilityId: session.facility.id,
    },
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Stable SHA-256 over canonicalized JSON of the Claude input context. Keys
 * sorted; arrays keep order (ordering is part of the signal). This runs in
 * the server action (node), so Node's `crypto` is fine.
 */
function hashInput(input: RebateInsightsInput): string {
  const canonical = canonicalJson(input)
  return createHash("sha256").update(canonical).digest("hex")
}

/**
 * Collapse time-drifting fields (`daysRemaining`) into weekly buckets for
 * cache-key stability. See Charles 2026-04-24 Bug 2 note at the call site.
 */
function bucketForHash(input: RebateInsightsInput): RebateInsightsInput {
  return {
    ...input,
    opportunities: input.opportunities.map((o) => ({
      ...o,
      daysRemaining: o.daysRemaining == null ? null : Math.floor(o.daysRemaining / 7),
    })),
  }
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
