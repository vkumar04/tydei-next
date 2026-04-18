/**
 * Rebate Optimizer — opportunity-detection engine (subsystem 0).
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-optimizer-rewrite.md §4.0
 *
 * PURE FUNCTIONS only. No Prisma imports. No side effects. Callers load
 * data from the DB, shape it into the typed inputs below, and feed the
 * engine. The engine returns:
 *
 *   - `buildRebateOpportunities(contracts, vendorSpendMap)` → sorted list
 *     of `RebateOpportunity` ranked by ROI descending (the page's main
 *     ranking feed).
 *   - `classifyUrgency(spendNeeded, daysRemaining)` → HIGH / MEDIUM / LOW
 *     classification per canonical §6.5.
 *   - `computeROI(additionalRebate, spendNeeded)` → additional-rebate /
 *     spend ratio as a percentage.
 *   - `computeTierGap(currentSpend, tiers, boundaryRule)` → current tier,
 *     next tier, and the spend distance to the next threshold.
 *   - `computeRebateUplift(currentSpend, spendNeeded, tiers, method,
 *     boundaryRule)` → extra rebate earned if the facility closes the gap.
 *
 * Tier math is delegated to the shared helpers in
 * `lib/rebates/engine/shared/` (determine-tier, cumulative, marginal,
 * sort-tiers). We do NOT re-derive tier logic here.
 *
 * Eligibility filter (canonical §6.2):
 *   - Only contracts with at least one SPEND_REBATE term are optimizable.
 *   - Contracts whose *only* rebate terms are CARVE_OUT or PO_REBATE are
 *     dropped with a reason — surfaced to the UI via the `droppedContracts`
 *     field on the engine output so the page can render the v1 footer
 *     ("N contracts use alternative rebate structures not supported here").
 *   - Tier-at-max (current tier is the top) → excluded (no next tier).
 *   - Zero-spend contracts → excluded (no spend history to optimize).
 */

import { calculateCumulativeRebate } from "@/lib/rebates/engine/shared/cumulative"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"
import { calculateMarginalRebate } from "@/lib/rebates/engine/shared/marginal"
import { sortTiersAscending } from "@/lib/rebates/engine/shared/sort-tiers"
import type {
  RebateTier,
  TierBoundaryRule,
  TierMethod,
} from "@/lib/rebates/engine/types"

// ─── Input shapes ─────────────────────────────────────────────────

/**
 * Discriminator for rebate term structure. Only `SPEND_REBATE` contracts
 * are optimizable in v1 (canonical §1 Out of scope). The `CARVE_OUT` and
 * `PO_REBATE` variants are surfaced as dropped contracts with a reason.
 */
export type RebateTermKind = "SPEND_REBATE" | "CARVE_OUT" | "PO_REBATE"

export interface RebateOpportunityTerm {
  /** Stable id so the UI can key opportunity cards to the originating term. */
  termId: string
  kind: RebateTermKind
  method: TierMethod
  boundaryRule: TierBoundaryRule
  /** Ordered tiers (any order; sorted by engine). */
  tiers: RebateTier[]
}

export interface RebateOpportunityContract {
  contractId: string
  contractName: string
  vendorId: string
  vendorName: string
  /** Contract end date — used for days-remaining + urgency classification. */
  endDate: Date | null
  /** All rebate terms on the contract. Engine picks the first SPEND_REBATE. */
  terms: RebateOpportunityTerm[]
}

/**
 * Vendor spend aggregate. Keyed by vendorId.
 *
 * The optimizer operates at the *vendor* level because SPEND_REBATE tiers
 * are evaluated against all eligible purchases from that vendor — not
 * against a single contract. Callers pre-aggregate from `COGRecord` or
 * `ContractPeriod.totalSpend`.
 */
export type VendorSpendMap = ReadonlyMap<string, number>

// ─── Output shapes ─────────────────────────────────────────────────

export type UrgencyLevel = "HIGH" | "MEDIUM" | "LOW"

export type DropReason =
  | "NO_REBATE_TERMS"
  | "ONLY_CARVE_OUT_OR_PO_REBATE"
  | "TIER_AT_MAX"
  | "ZERO_SPEND"
  | "NO_TIERS"

export interface DroppedContract {
  contractId: string
  contractName: string
  vendorName: string
  reason: DropReason
}

export interface TierGap {
  currentTier: RebateTier | null
  nextTier: RebateTier | null
  spendNeeded: number
}

export interface RebateOpportunity {
  contractId: string
  contractName: string
  vendorId: string
  vendorName: string
  termId: string
  /** Current eligible spend against this term's tier ladder. */
  currentSpend: number
  /** Current tier number (null when below the first tier). */
  currentTierNumber: number | null
  currentRebateRate: number
  /** Next tier number (guaranteed present on an opportunity). */
  nextTierNumber: number
  nextRebateRate: number
  nextTierThreshold: number
  /** Dollars needed to cross into the next tier. */
  spendNeeded: number
  /** Rebate earned today on currentSpend. */
  currentRebate: number
  /** Rebate earned if facility spends `spendNeeded` more. */
  projectedRebate: number
  /** Incremental rebate unlocked by closing the spend gap. */
  additionalRebate: number
  /** additionalRebate / spendNeeded × 100 (NaN-safe — returns 0). */
  roi: number
  /** Days until contract endDate; null when endDate unknown. */
  daysRemaining: number | null
  urgency: UrgencyLevel
}

export interface RebateOptimizerEngineOutput {
  opportunities: RebateOpportunity[]
  droppedContracts: DroppedContract[]
}

// ─── Urgency + ROI primitives ──────────────────────────────────────

/**
 * Classify urgency from spend gap + days remaining (canonical §6.5):
 *
 *   HIGH   — spendNeeded < $100K OR daysRemaining < 60
 *   MEDIUM — spendNeeded < $250K
 *   LOW    — otherwise
 *
 * `daysRemaining = null` is treated as "unbounded" — only the spend rule
 * can promote to HIGH / MEDIUM. Negative `daysRemaining` (contract ended)
 * is clamped to 0 for classification purposes.
 */
export function classifyUrgency(
  spendNeeded: number,
  daysRemaining: number | null,
): UrgencyLevel {
  const clampedDays =
    daysRemaining === null ? null : Math.max(0, daysRemaining)

  if (spendNeeded < 100_000) return "HIGH"
  if (clampedDays !== null && clampedDays < 60) return "HIGH"
  if (spendNeeded < 250_000) return "MEDIUM"
  return "LOW"
}

/**
 * Return-on-spend ratio as a percentage:
 *
 *   ROI = additionalRebate / spendNeeded × 100
 *
 * Zero-guard: when `spendNeeded <= 0` (already at tier, degenerate), we
 * return 0 to avoid Infinity propagating into ranking.
 */
export function computeROI(
  additionalRebate: number,
  spendNeeded: number,
): number {
  if (!Number.isFinite(spendNeeded) || spendNeeded <= 0) return 0
  if (!Number.isFinite(additionalRebate)) return 0
  return (additionalRebate / spendNeeded) * 100
}

// ─── Tier-gap + rebate-uplift ──────────────────────────────────────

/**
 * Compute current tier, next tier, and spend-to-next-threshold for the
 * given spend against a tier ladder.
 *
 * Uses the shared `determineTier` (which is EXCLUSIVE / INCLUSIVE aware
 * and scans-to-end per audit fix [A1]) — same logic as the live rebate
 * engine, so opportunity math can't drift from booked rebates.
 *
 *   - `currentTier === null` when spend is below the lowest tier. The
 *     "next tier" then becomes the first tier in the ladder.
 *   - `nextTier === null` when already at the top tier. `spendNeeded`
 *     is Infinity in that case — the caller should filter it out.
 */
export function computeTierGap(
  currentSpend: number,
  tiers: RebateTier[],
  boundaryRule: TierBoundaryRule,
): TierGap {
  if (tiers.length === 0) {
    return { currentTier: null, nextTier: null, spendNeeded: Infinity }
  }

  const sorted = sortTiersAscending(tiers)
  const currentTier = determineTier(currentSpend, sorted, boundaryRule)

  // Find the first tier whose thresholdMin is strictly greater than
  // the current tier's thresholdMin (or > 0 when no tier qualifies).
  const anchorMin = currentTier?.thresholdMin ?? -Infinity
  const nextTier =
    sorted.find((t) => t.thresholdMin > anchorMin) ?? null

  if (nextTier === null) {
    return { currentTier, nextTier: null, spendNeeded: Infinity }
  }

  // Under EXCLUSIVE, the next tier starts AT thresholdMin so the gap is
  // (threshold - spend). Under INCLUSIVE, the next tier starts ABOVE
  // thresholdMin so one extra cent is required to cross — but we report
  // the whole-dollar gap (threshold - spend) for UX clarity; the engine
  // never claims the facility is "in" the next tier until the real rebate
  // engine confirms it.
  const rawGap = nextTier.thresholdMin - currentSpend
  const spendNeeded = Math.max(0, rawGap)

  return { currentTier, nextTier, spendNeeded }
}

/**
 * Compute rebate uplift when the facility closes a tier gap.
 *
 * Returns the incremental rebate (projected − current). Uses the shared
 * cumulative/marginal helpers so uplift matches booked-rebate semantics.
 *
 *   method = CUMULATIVE → `(newTotal × newRate) − (currentSpend × currentRate)`
 *   method = MARGINAL   → Δ of bracket sums. Marginal is monotonic so
 *                         the delta is always ≥ 0.
 */
export function computeRebateUplift(
  currentSpend: number,
  spendNeeded: number,
  tiers: RebateTier[],
  method: TierMethod,
  boundaryRule: TierBoundaryRule,
): { currentRebate: number; projectedRebate: number; additionalRebate: number } {
  const newTotal = currentSpend + Math.max(0, spendNeeded)

  if (method === "MARGINAL") {
    const now = calculateMarginalRebate(currentSpend, tiers, boundaryRule)
    const next = calculateMarginalRebate(newTotal, tiers, boundaryRule)
    return {
      currentRebate: now.totalRebate,
      projectedRebate: next.totalRebate,
      additionalRebate: Math.max(0, next.totalRebate - now.totalRebate),
    }
  }

  const now = calculateCumulativeRebate(currentSpend, tiers, boundaryRule)
  const next = calculateCumulativeRebate(newTotal, tiers, boundaryRule)
  return {
    currentRebate: now.rebate,
    projectedRebate: next.rebate,
    additionalRebate: Math.max(0, next.rebate - now.rebate),
  }
}

// ─── Main entrypoint ───────────────────────────────────────────────

/**
 * Compute days between `to` and `from`, flooring at 0.
 * Returns null when `to` is nullish.
 */
function daysBetween(from: Date, to: Date | null): number | null {
  if (to === null) return null
  const ms = to.getTime() - from.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

export interface BuildRebateOpportunitiesOptions {
  /** Evaluation date — defaults to `new Date()`. Injectable for tests. */
  now?: Date
}

/**
 * Walk the supplied contracts, compute tier-advancement opportunities,
 * and return them sorted by ROI descending.
 *
 * Contracts are dropped (not thrown) when they can't be optimized:
 *
 *   - NO_REBATE_TERMS              — no rebate terms at all
 *   - ONLY_CARVE_OUT_OR_PO_REBATE  — no SPEND_REBATE term (v1 drops these)
 *   - NO_TIERS                     — SPEND_REBATE term but empty tier ladder
 *   - ZERO_SPEND                   — no spend history for the vendor
 *   - TIER_AT_MAX                  — already at the top tier
 *
 * Drops are surfaced in `output.droppedContracts` so the UI can render
 * the v1 footer ("N contracts use alternative rebate structures").
 */
export function buildRebateOpportunities(
  contracts: readonly RebateOpportunityContract[],
  vendorSpendMap: VendorSpendMap,
  options: BuildRebateOpportunitiesOptions = {},
): RebateOptimizerEngineOutput {
  const now = options.now ?? new Date()
  const opportunities: RebateOpportunity[] = []
  const droppedContracts: DroppedContract[] = []

  for (const contract of contracts) {
    // Step 1 — eligibility filter: must have a SPEND_REBATE term.
    if (contract.terms.length === 0) {
      droppedContracts.push({
        contractId: contract.contractId,
        contractName: contract.contractName,
        vendorName: contract.vendorName,
        reason: "NO_REBATE_TERMS",
      })
      continue
    }

    const spendTerm = contract.terms.find((t) => t.kind === "SPEND_REBATE")
    if (!spendTerm) {
      droppedContracts.push({
        contractId: contract.contractId,
        contractName: contract.contractName,
        vendorName: contract.vendorName,
        reason: "ONLY_CARVE_OUT_OR_PO_REBATE",
      })
      continue
    }

    // Step 2 — tier ladder must be non-empty.
    if (spendTerm.tiers.length === 0) {
      droppedContracts.push({
        contractId: contract.contractId,
        contractName: contract.contractName,
        vendorName: contract.vendorName,
        reason: "NO_TIERS",
      })
      continue
    }

    // Step 3 — must have spend history to optimize.
    const currentSpend = vendorSpendMap.get(contract.vendorId) ?? 0
    if (currentSpend <= 0) {
      droppedContracts.push({
        contractId: contract.contractId,
        contractName: contract.contractName,
        vendorName: contract.vendorName,
        reason: "ZERO_SPEND",
      })
      continue
    }

    // Step 4 — tier gap analysis. Drop when already at top tier.
    const gap = computeTierGap(
      currentSpend,
      spendTerm.tiers,
      spendTerm.boundaryRule,
    )
    if (gap.nextTier === null) {
      droppedContracts.push({
        contractId: contract.contractId,
        contractName: contract.contractName,
        vendorName: contract.vendorName,
        reason: "TIER_AT_MAX",
      })
      continue
    }

    // Step 5 — rebate uplift via shared engine math.
    const uplift = computeRebateUplift(
      currentSpend,
      gap.spendNeeded,
      spendTerm.tiers,
      spendTerm.method,
      spendTerm.boundaryRule,
    )

    const daysRemaining = daysBetween(now, contract.endDate)

    opportunities.push({
      contractId: contract.contractId,
      contractName: contract.contractName,
      vendorId: contract.vendorId,
      vendorName: contract.vendorName,
      termId: spendTerm.termId,
      currentSpend,
      currentTierNumber: gap.currentTier?.tierNumber ?? null,
      currentRebateRate: gap.currentTier?.rebateValue ?? 0,
      nextTierNumber: gap.nextTier.tierNumber,
      nextRebateRate: gap.nextTier.rebateValue,
      nextTierThreshold: gap.nextTier.thresholdMin,
      spendNeeded: gap.spendNeeded,
      currentRebate: uplift.currentRebate,
      projectedRebate: uplift.projectedRebate,
      additionalRebate: uplift.additionalRebate,
      roi: computeROI(uplift.additionalRebate, gap.spendNeeded),
      daysRemaining,
      urgency: classifyUrgency(gap.spendNeeded, daysRemaining),
    })
  }

  // Sort: ROI descending. Stable tiebreak on additionalRebate descending,
  // then contractId for deterministic output (tests + snapshotting).
  opportunities.sort((a, b) => {
    if (b.roi !== a.roi) return b.roi - a.roi
    if (b.additionalRebate !== a.additionalRebate) {
      return b.additionalRebate - a.additionalRebate
    }
    return a.contractId.localeCompare(b.contractId)
  })

  return { opportunities, droppedContracts }
}
