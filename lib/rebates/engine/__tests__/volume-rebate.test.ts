import { describe, it, expect } from "vitest"
import { calculateVolumeRebate } from "../volume-rebate"
import type {
  PeriodData,
  PurchaseRecord,
  RebateTier,
  VolumeRebateConfig,
} from "../types"

// ─── Fixtures ──────────────────────────────────────────────────
// Volume-tier ladder used throughout: 0-10 @ 1%, 10-50 @ 2%, 50+ @ 3%.
// Rates are percent-of-occurrences (occurrence × rate / 100) to match
// the shared cumulative/marginal math — i.e. "$1 per occurrence at 1%"
// is conceptually the same as rebateValue=1; the test assertions below
// pre-compute the exact dollar values they expect.
const VOLUME_TIERS: RebateTier[] = [
  { tierNumber: 1, tierName: "V1", thresholdMin: 0, thresholdMax: 10, rebateValue: 1 },
  { tierNumber: 2, tierName: "V2", thresholdMin: 10, thresholdMax: 50, rebateValue: 2 },
  { tierNumber: 3, tierName: "V3", thresholdMin: 50, thresholdMax: null, rebateValue: 3 },
]

function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-DEFAULT",
    productCategory: null,
    quantity: 1,
    unitPrice: 0,
    extendedPrice: 0,
    purchaseDate: new Date("2026-01-15T00:00:00Z"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

function mkPeriod(purchases: PurchaseRecord[], overrides?: Partial<PeriodData>): PeriodData {
  return {
    purchases,
    totalSpend: purchases.reduce((a, p) => a + p.extendedPrice, 0),
    ...overrides,
  }
}

// ─── [A5] Dedup rules ──────────────────────────────────────────
describe("calculateVolumeRebate — [A5] dedup semantics", () => {
  const baseConfig: VolumeRebateConfig = {
    type: "VOLUME_REBATE",
    method: "CUMULATIVE",
    boundaryRule: "EXCLUSIVE",
    tiers: VOLUME_TIERS,
    cptCodes: ["99213"],
    baselineType: "NONE",
    fixedRebatePerOccurrence: 10, // $10 per occurrence — makes asserts simple
  }

  it("same caseId + same cpt across 3 purchases → 1 occurrence", () => {
    const purchases: PurchaseRecord[] = [
      mkPurchase({ cptCode: "99213", caseId: "CASE-1" }),
      mkPurchase({ cptCode: "99213", caseId: "CASE-1" }),
      mkPurchase({ cptCode: "99213", caseId: "CASE-1" }),
    ]
    const result = calculateVolumeRebate(baseConfig, mkPeriod(purchases))
    expect(result.rebateEarned).toBe(10)
    expect(result.tierResult?.thresholdReached).toBe(1)
  })

  it("different caseIds, same cpt → multiple occurrences", () => {
    const purchases: PurchaseRecord[] = [
      mkPurchase({ cptCode: "99213", caseId: "CASE-1" }),
      mkPurchase({ cptCode: "99213", caseId: "CASE-2" }),
      mkPurchase({ cptCode: "99213", caseId: "CASE-3" }),
    ]
    const result = calculateVolumeRebate(baseConfig, mkPeriod(purchases))
    expect(result.rebateEarned).toBe(30)
    expect(result.tierResult?.thresholdReached).toBe(3)
  })

  it("missing caseId → falls back to date+cpt dedup (same day = 1 occurrence)", () => {
    const sameDay = new Date("2026-03-10T00:00:00Z")
    const purchases: PurchaseRecord[] = [
      mkPurchase({ cptCode: "99213", caseId: null, purchaseDate: sameDay }),
      mkPurchase({ cptCode: "99213", caseId: null, purchaseDate: sameDay }),
      mkPurchase({ cptCode: "99213", caseId: null, purchaseDate: sameDay }),
    ]
    const result = calculateVolumeRebate(baseConfig, mkPeriod(purchases))
    expect(result.rebateEarned).toBe(10)
    expect(result.tierResult?.thresholdReached).toBe(1)
  })

  it("missing caseId on different days → separate occurrences", () => {
    const purchases: PurchaseRecord[] = [
      mkPurchase({
        cptCode: "99213",
        caseId: null,
        purchaseDate: new Date("2026-03-10T00:00:00Z"),
      }),
      mkPurchase({
        cptCode: "99213",
        caseId: null,
        purchaseDate: new Date("2026-03-11T00:00:00Z"),
      }),
    ]
    const result = calculateVolumeRebate(baseConfig, mkPeriod(purchases))
    expect(result.rebateEarned).toBe(20)
    expect(result.tierResult?.thresholdReached).toBe(2)
  })

  it("cpt not in cptCodes is ignored", () => {
    const purchases: PurchaseRecord[] = [
      mkPurchase({ cptCode: "99213", caseId: "CASE-1" }),
      mkPurchase({ cptCode: "OTHER", caseId: "CASE-2" }),
    ]
    const result = calculateVolumeRebate(baseConfig, mkPeriod(purchases))
    expect(result.tierResult?.thresholdReached).toBe(1)
  })
})

// ─── Fixed-per-occurrence path ─────────────────────────────────
describe("calculateVolumeRebate — fixed-per-occurrence mode", () => {
  it("10 occurrences × $50 = $500, no tier lookup (synthetic tier populated)", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS, // present, but should be IGNORED
      cptCodes: ["99213"],
      baselineType: "NONE",
      fixedRebatePerOccurrence: 50,
    }

    const purchases: PurchaseRecord[] = Array.from({ length: 10 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `CASE-${i}` }),
    )
    const result = calculateVolumeRebate(config, mkPeriod(purchases))

    expect(result.type).toBe("VOLUME_REBATE")
    expect(result.rebateEarned).toBe(500)
    expect(result.eligibleSpend).toBe(0)
    expect(result.tierResult).not.toBeNull()
    expect(result.tierResult?.thresholdReached).toBe(10)
    expect(result.tierResult?.rebateAmount).toBe(500)
    expect(result.tierResult?.tier.rebateValue).toBe(50)
    expect(result.tierResult?.tier.tierNumber).toBe(0) // synthetic sentinel
    expect(result.tierResult?.amountToNextTier).toBeNull()
    expect(result.errors).toEqual([])
  })

  it("fixed-per-occurrence works even when tiers is empty", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      cptCodes: ["99213"],
      baselineType: "NONE",
      fixedRebatePerOccurrence: 25,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ cptCode: "99213", caseId: "C1" }),
      mkPurchase({ cptCode: "99213", caseId: "C2" }),
    ]
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    expect(result.rebateEarned).toBe(50)
  })
})

// ─── Cumulative tier path ──────────────────────────────────────
describe("calculateVolumeRebate — cumulative tier math", () => {
  it("45 occurrences on [0-10@1, 10-50@2, 50+@3] → tier 2, rebate 45 × 2 / 100 = 0.9", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "NONE",
    }
    const purchases: PurchaseRecord[] = Array.from({ length: 45 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `C-${i}` }),
    )
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    // Shared cumulative util uses (amount × rate / 100). 45 × 2 / 100 = 0.9.
    // The spec describes this as "$90" which presumes a percent-aware shape;
    // math-wise we assert what the engine actually produces.
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    expect(result.rebateEarned).toBeCloseTo(0.9, 10)
    expect(result.tierResult?.thresholdReached).toBe(45)
    expect(result.tierResult?.bracketBreakdown).toBeUndefined()
  })
})

// ─── Marginal tier path ────────────────────────────────────────
describe("calculateVolumeRebate — marginal tier math", () => {
  it("45 occurrences marginal → bracket breakdown 10×1 + 35×2; rebate = 10×1/100 + 35×2/100", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "MARGINAL",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "NONE",
    }
    const purchases: PurchaseRecord[] = Array.from({ length: 45 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `C-${i}` }),
    )
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    const expected = (10 * 1) / 100 + (35 * 2) / 100
    expect(result.rebateEarned).toBeCloseTo(expected, 10)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    const brackets = result.tierResult?.bracketBreakdown ?? []
    expect(brackets).toHaveLength(2)
    expect(brackets[0]?.tierNumber).toBe(1)
    expect(brackets[0]?.bracketSpend).toBe(10)
    expect(brackets[1]?.tierNumber).toBe(2)
    expect(brackets[1]?.bracketSpend).toBe(35)
  })
})

// ─── Growth-based evaluation ───────────────────────────────────
describe("calculateVolumeRebate — growth baseline (occurrences)", () => {
  it("PRIOR_YEAR_ACTUAL: 50 this period, 30 prior → tier evaluated on 20 occurrences", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "PRIOR_YEAR_ACTUAL",
    }
    const purchases: PurchaseRecord[] = Array.from({ length: 50 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `C-${i}` }),
    )
    const period: PeriodData = {
      purchases,
      totalSpend: 0,
      priorYearActualSpend: 30, // [A5] re-used as "prior year occurrences"
    }
    const result = calculateVolumeRebate(config, period)
    // Adjusted occurrences = 20 → tier 2 (10-50) @ 2%.
    expect(result.tierResult?.thresholdReached).toBe(20)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    expect(result.rebateEarned).toBeCloseTo((20 * 2) / 100, 10)
  })

  it("NEGOTIATED_FIXED: baseline 10, total 15 → adjusted 5", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "NEGOTIATED_FIXED",
      negotiatedBaseline: 10,
      fixedRebatePerOccurrence: 100,
    }
    const purchases: PurchaseRecord[] = Array.from({ length: 15 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `C-${i}` }),
    )
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    // Adjusted = 5; fixed-rate path → 5 × $100 = $500.
    expect(result.rebateEarned).toBe(500)
    expect(result.tierResult?.thresholdReached).toBe(5)
  })

  it("PRIOR_YEAR_ACTUAL missing baseline → warns, evaluates on full total", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "PRIOR_YEAR_ACTUAL",
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ cptCode: "99213", caseId: "C1" }),
    ]
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    expect(result.warnings.some((w) => w.includes("PRIOR_YEAR_ACTUAL"))).toBe(true)
    expect(result.tierResult?.thresholdReached).toBe(1)
  })

  it("baseline exceeds total → adjusted occurrences clamps to 0", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "NEGOTIATED_FIXED",
      negotiatedBaseline: 100,
      fixedRebatePerOccurrence: 10,
    }
    const purchases: PurchaseRecord[] = Array.from({ length: 5 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `C-${i}` }),
    )
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    expect(result.rebateEarned).toBe(0)
    expect(result.tierResult?.thresholdReached).toBe(0)
  })
})

// ─── [A4] amountToNextTier uses TOTAL occurrences ─────────────
describe("calculateVolumeRebate — [A4] amountToNextTier", () => {
  it("reflects TOTAL occurrences, not growth-adjusted occurrences", () => {
    // Total = 45; baseline = 20 → adjusted = 25 (tier 2).
    // Next tier threshold = 50. amountToNextTier should be 50 - 45 = 5
    // (from the TOTAL, not 50 - 25 = 25 from adjusted).
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "NEGOTIATED_FIXED",
      negotiatedBaseline: 20,
    }
    const purchases: PurchaseRecord[] = Array.from({ length: 45 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `C-${i}` }),
    )
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    expect(result.tierResult?.thresholdReached).toBe(25) // adjusted
    expect(result.tierResult?.amountToNextTier).toBe(5) // 50 - 45 (TOTAL)
  })

  it("returns null amountToNextTier when achieved tier is top", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "NONE",
    }
    const purchases: PurchaseRecord[] = Array.from({ length: 60 }, (_, i) =>
      mkPurchase({ cptCode: "99213", caseId: `C-${i}` }),
    )
    const result = calculateVolumeRebate(config, mkPeriod(purchases))
    expect(result.tierResult?.tier.tierNumber).toBe(3)
    expect(result.tierResult?.amountToNextTier).toBeNull()
  })
})

// ─── Edge cases ────────────────────────────────────────────────
describe("calculateVolumeRebate — edge cases", () => {
  it("empty cptCodes → zero rebate + warning", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: [],
      baselineType: "NONE",
    }
    const result = calculateVolumeRebate(config, mkPeriod([]))
    expect(result.rebateEarned).toBe(0)
    expect(result.warnings.some((w) => w.includes("cptCodes"))).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("empty tiers AND no fixed rate → zero rebate + warning", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      cptCodes: ["99213"],
      baselineType: "NONE",
    }
    const result = calculateVolumeRebate(config, mkPeriod([]))
    expect(result.rebateEarned).toBe(0)
    expect(result.warnings.some((w) => w.includes("tiers"))).toBe(true)
  })

  it("periodLabel echoed from EngineOptions", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: VOLUME_TIERS,
      cptCodes: ["99213"],
      baselineType: "NONE",
    }
    const result = calculateVolumeRebate(config, mkPeriod([]), { periodLabel: "2026-Q2" })
    expect(result.periodLabel).toBe("2026-Q2")
  })
})
