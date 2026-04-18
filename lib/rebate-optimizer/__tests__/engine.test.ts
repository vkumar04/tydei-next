/**
 * Rebate Optimizer — engine tests (subsystem 0).
 *
 * Covers the acceptance criteria from
 * docs/superpowers/specs/2026-04-18-rebate-optimizer-rewrite.md §4.0:
 *
 *   - Engine returns typed opportunities sorted by ROI descending.
 *   - tier-at-max (no next tier → excluded)
 *   - zero-spend contract (excluded)
 *   - contract with non-spend_rebate-only terms (excluded with reason)
 *
 * Plus edge cases for the primitives:
 *   - classifyUrgency boundary conditions
 *   - computeROI zero-guards
 *   - computeTierGap below-lowest-tier + EXCLUSIVE vs INCLUSIVE
 *   - computeRebateUplift for CUMULATIVE vs MARGINAL
 */

import { describe, it, expect } from "vitest"
import type { RebateTier } from "@/lib/rebates/engine/types"
import {
  buildRebateOpportunities,
  classifyUrgency,
  computeROI,
  computeRebateUplift,
  computeTierGap,
  type RebateOpportunityContract,
  type VendorSpendMap,
} from "../engine"

// ─── Fixture helpers ──────────────────────────────────────────────

function tier(
  tierNumber: number,
  thresholdMin: number,
  thresholdMax: number | null,
  rebateValue: number,
): RebateTier {
  return { tierNumber, thresholdMin, thresholdMax, rebateValue }
}

const T1 = tier(1, 0, 50_000, 2)
const T2 = tier(2, 50_000, 100_000, 4)
const T3 = tier(3, 100_000, null, 6)

function contract(overrides: Partial<RebateOpportunityContract> = {}): RebateOpportunityContract {
  return {
    contractId: "c1",
    contractName: "Test Contract",
    vendorId: "v1",
    vendorName: "Test Vendor",
    endDate: new Date("2026-12-31"),
    terms: [
      {
        termId: "t1",
        kind: "SPEND_REBATE",
        method: "CUMULATIVE",
        boundaryRule: "EXCLUSIVE",
        tiers: [T1, T2, T3],
      },
    ],
    ...overrides,
  }
}

function spendMap(entries: Array<[string, number]>): VendorSpendMap {
  return new Map(entries)
}

const NOW = new Date("2026-04-18")

// ─── classifyUrgency ──────────────────────────────────────────────

describe("classifyUrgency", () => {
  it("HIGH when spendNeeded < $100K", () => {
    expect(classifyUrgency(99_999, 365)).toBe("HIGH")
  })

  it("HIGH when daysRemaining < 60 regardless of spend", () => {
    expect(classifyUrgency(1_000_000, 59)).toBe("HIGH")
  })

  it("MEDIUM when spendNeeded in [$100K, $250K) and daysRemaining >= 60", () => {
    expect(classifyUrgency(150_000, 180)).toBe("MEDIUM")
    expect(classifyUrgency(249_999, 60)).toBe("MEDIUM")
  })

  it("LOW when spendNeeded >= $250K and no time pressure", () => {
    expect(classifyUrgency(250_000, 365)).toBe("LOW")
    expect(classifyUrgency(1_000_000, null)).toBe("LOW")
  })

  it("treats null daysRemaining as no time pressure", () => {
    expect(classifyUrgency(300_000, null)).toBe("LOW")
    expect(classifyUrgency(50_000, null)).toBe("HIGH") // still HIGH via spend rule
  })

  it("negative daysRemaining clamps to 0 (past-due contract is HIGH)", () => {
    expect(classifyUrgency(500_000, -10)).toBe("HIGH")
  })

  it("boundary — exactly $100K is MEDIUM, exactly 60 days is MEDIUM", () => {
    expect(classifyUrgency(100_000, 60)).toBe("MEDIUM")
  })
})

// ─── computeROI ───────────────────────────────────────────────────

describe("computeROI", () => {
  it("returns additionalRebate / spendNeeded × 100", () => {
    expect(computeROI(2_000, 20_000)).toBe(10)
  })

  it("returns 0 when spendNeeded is 0 (avoid Infinity)", () => {
    expect(computeROI(1_000, 0)).toBe(0)
  })

  it("returns 0 when spendNeeded is negative", () => {
    expect(computeROI(1_000, -500)).toBe(0)
  })

  it("returns 0 on non-finite inputs", () => {
    expect(computeROI(NaN, 100)).toBe(0)
    expect(computeROI(100, Infinity)).toBe(0)
  })
})

// ─── computeTierGap ───────────────────────────────────────────────

describe("computeTierGap", () => {
  it("returns nextTier = null when at top tier", () => {
    const gap = computeTierGap(150_000, [T1, T2, T3], "EXCLUSIVE")
    expect(gap.currentTier?.tierNumber).toBe(3)
    expect(gap.nextTier).toBeNull()
    expect(gap.spendNeeded).toBe(Infinity)
  })

  it("returns spend distance to next threshold under EXCLUSIVE", () => {
    const gap = computeTierGap(30_000, [T1, T2, T3], "EXCLUSIVE")
    expect(gap.currentTier?.tierNumber).toBe(1)
    expect(gap.nextTier?.tierNumber).toBe(2)
    expect(gap.spendNeeded).toBe(20_000)
  })

  it("returns correct gap even when below the lowest tier", () => {
    const noZeroTier = [tier(1, 10_000, 50_000, 2), T2, T3]
    const gap = computeTierGap(5_000, noZeroTier, "EXCLUSIVE")
    expect(gap.currentTier).toBeNull()
    expect(gap.nextTier?.tierNumber).toBe(1)
    expect(gap.spendNeeded).toBe(5_000)
  })

  it("never returns negative spendNeeded", () => {
    // value exactly at the next threshold: under INCLUSIVE it's still in
    // tier 1, so gap to tier 2 is 0 (or tiny), never negative.
    const gap = computeTierGap(50_000, [T1, T2, T3], "INCLUSIVE")
    expect(gap.spendNeeded).toBeGreaterThanOrEqual(0)
  })

  it("empty tier ladder returns null tiers + Infinity gap", () => {
    const gap = computeTierGap(10_000, [], "EXCLUSIVE")
    expect(gap.currentTier).toBeNull()
    expect(gap.nextTier).toBeNull()
    expect(gap.spendNeeded).toBe(Infinity)
  })
})

// ─── computeRebateUplift ──────────────────────────────────────────

describe("computeRebateUplift", () => {
  it("CUMULATIVE — uplift is the full-spend rate delta applied to new total", () => {
    // currentSpend = $30K → tier 1 (2%) → $600
    // newTotal = $60K → tier 2 (4%) → $2,400
    // additionalRebate = $1,800
    const result = computeRebateUplift(30_000, 30_000, [T1, T2, T3], "CUMULATIVE", "EXCLUSIVE")
    expect(result.currentRebate).toBe(600)
    expect(result.projectedRebate).toBe(2_400)
    expect(result.additionalRebate).toBe(1_800)
  })

  it("MARGINAL — uplift stacks brackets", () => {
    // currentSpend = $30K → tier 1 bracket only → $30K × 2% = $600
    // newTotal = $60K → tier 1 bracket ($50K × 2% = $1,000) + tier 2 bracket ($10K × 4% = $400) = $1,400
    // additionalRebate = $800
    const result = computeRebateUplift(30_000, 30_000, [T1, T2, T3], "MARGINAL", "EXCLUSIVE")
    expect(result.currentRebate).toBe(600)
    expect(result.projectedRebate).toBe(1_400)
    expect(result.additionalRebate).toBe(800)
  })

  it("additionalRebate is never negative (clamped)", () => {
    // Synthetic: currentSpend already > newTotal (spendNeeded = 0).
    const result = computeRebateUplift(60_000, 0, [T1, T2, T3], "CUMULATIVE", "EXCLUSIVE")
    expect(result.additionalRebate).toBe(0)
  })
})

// ─── buildRebateOpportunities — acceptance cases ──────────────────

describe("buildRebateOpportunities", () => {
  it("happy path — returns sorted opportunities ranked by ROI descending", () => {
    const contracts: RebateOpportunityContract[] = [
      contract({ contractId: "low-roi", vendorId: "v-low" }),
      contract({ contractId: "high-roi", vendorId: "v-high" }),
    ]
    // low-roi: spend $30K, tiers $50K / $100K / null. Gap = $20K, uplift small.
    // high-roi: spend $95K, nearly at tier 3. Small gap, big rebate bump.
    const spend = spendMap([
      ["v-low", 30_000],
      ["v-high", 95_000],
    ])

    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(2)
    expect(result.droppedContracts).toHaveLength(0)

    // Both present; first has higher ROI.
    expect(result.opportunities[0]!.roi).toBeGreaterThan(
      result.opportunities[1]!.roi,
    )
    // high-roi should rank first (small gap, big uplift).
    expect(result.opportunities[0]!.contractId).toBe("high-roi")
  })

  it("excludes tier-at-max contracts (no next tier)", () => {
    const contracts = [contract({ contractId: "maxed" })]
    const spend = spendMap([["v1", 200_000]]) // above top tier (100K)
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(0)
    expect(result.droppedContracts).toHaveLength(1)
    expect(result.droppedContracts[0]!.reason).toBe("TIER_AT_MAX")
    expect(result.droppedContracts[0]!.contractId).toBe("maxed")
  })

  it("excludes zero-spend contracts", () => {
    const contracts = [contract({ contractId: "nospend" })]
    const spend = spendMap([]) // vendor not in map
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(0)
    expect(result.droppedContracts).toHaveLength(1)
    expect(result.droppedContracts[0]!.reason).toBe("ZERO_SPEND")
  })

  it("excludes contracts whose only terms are CARVE_OUT or PO_REBATE", () => {
    const contracts: RebateOpportunityContract[] = [
      contract({
        contractId: "carve-only",
        terms: [
          {
            termId: "t-carve",
            kind: "CARVE_OUT",
            method: "CUMULATIVE",
            boundaryRule: "EXCLUSIVE",
            tiers: [T1, T2],
          },
        ],
      }),
      contract({
        contractId: "po-only",
        terms: [
          {
            termId: "t-po",
            kind: "PO_REBATE",
            method: "CUMULATIVE",
            boundaryRule: "EXCLUSIVE",
            tiers: [T1, T2],
          },
        ],
      }),
    ]
    const spend = spendMap([["v1", 30_000]])
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(0)
    expect(result.droppedContracts).toHaveLength(2)
    expect(result.droppedContracts.every((d) => d.reason === "ONLY_CARVE_OUT_OR_PO_REBATE")).toBe(true)
  })

  it("includes a contract when it has SPEND_REBATE alongside CARVE_OUT", () => {
    const contracts: RebateOpportunityContract[] = [
      contract({
        contractId: "mixed",
        terms: [
          {
            termId: "t-carve",
            kind: "CARVE_OUT",
            method: "CUMULATIVE",
            boundaryRule: "EXCLUSIVE",
            tiers: [T1],
          },
          {
            termId: "t-spend",
            kind: "SPEND_REBATE",
            method: "CUMULATIVE",
            boundaryRule: "EXCLUSIVE",
            tiers: [T1, T2, T3],
          },
        ],
      }),
    ]
    const spend = spendMap([["v1", 30_000]])
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0]!.termId).toBe("t-spend")
  })

  it("drops contracts with no terms at all", () => {
    const contracts = [contract({ terms: [] })]
    const spend = spendMap([["v1", 30_000]])
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(0)
    expect(result.droppedContracts[0]!.reason).toBe("NO_REBATE_TERMS")
  })

  it("drops SPEND_REBATE contracts with empty tier ladder", () => {
    const contracts = [
      contract({
        terms: [
          {
            termId: "t-empty",
            kind: "SPEND_REBATE",
            method: "CUMULATIVE",
            boundaryRule: "EXCLUSIVE",
            tiers: [],
          },
        ],
      }),
    ]
    const spend = spendMap([["v1", 30_000]])
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(0)
    expect(result.droppedContracts[0]!.reason).toBe("NO_TIERS")
  })

  it("daysRemaining reflects contract endDate vs injected now", () => {
    const contracts = [
      contract({
        contractId: "dated",
        endDate: new Date("2026-06-17"), // 60 days from 2026-04-18
      }),
    ]
    const spend = spendMap([["v1", 30_000]])
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0]!.daysRemaining).toBe(60)
  })

  it("daysRemaining is null when endDate is null", () => {
    const contracts = [contract({ endDate: null })]
    const spend = spendMap([["v1", 30_000]])
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(result.opportunities[0]!.daysRemaining).toBeNull()
  })

  it("urgency HIGH when contract is days-remaining-pressured", () => {
    const contracts = [
      contract({
        endDate: new Date("2026-05-18"), // 30 days from now
      }),
    ]
    // large spend gap → would be LOW on spend alone
    const spend = spendMap([["v1", 1_000]])
    const result = buildRebateOpportunities(contracts, spend, { now: NOW })

    // Spend gap is large but daysRemaining < 60 → HIGH.
    expect(result.opportunities[0]!.urgency).toBe("HIGH")
  })

  it("output is deterministic — same inputs → same ordering", () => {
    const contracts: RebateOpportunityContract[] = [
      contract({ contractId: "a", vendorId: "va" }),
      contract({ contractId: "b", vendorId: "vb" }),
      contract({ contractId: "c", vendorId: "vc" }),
    ]
    const spend = spendMap([
      ["va", 30_000],
      ["vb", 30_000],
      ["vc", 30_000],
    ])

    const r1 = buildRebateOpportunities(contracts, spend, { now: NOW })
    const r2 = buildRebateOpportunities(contracts, spend, { now: NOW })

    expect(r1.opportunities.map((o) => o.contractId)).toEqual(
      r2.opportunities.map((o) => o.contractId),
    )
    // When ROI ties, the tiebreak is contractId ascending.
    expect(r1.opportunities.map((o) => o.contractId)).toEqual(["a", "b", "c"])
  })
})
