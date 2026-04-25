/**
 * Unit tests for the pending-terms extractor in
 * `lib/actions/pending-contracts.ts`. The action lives behind a
 * `"use server"` boundary, so (matching `pending-pricing-extract.test.ts`)
 * we re-implement the extractor inline and lock in its behavior.
 *
 * Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5): primary
 * coverage is the volume_rebate / market_share / scope round-trip.
 * Pre-fix, the structured `terms` validator + extractor stripped
 * volumeBaseline / desiredMarketShare / volumeType (term) and
 * volumeMin/Max + marketShareMin/Max (tier), so the engine had nothing
 * to match on after approval and computed $0 forever.
 */
import { describe, it, expect } from "vitest"

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}
function coerceString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim()
  return null
}
function parseDateOr(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return fallback
}
function extractPendingTerms(termsJson: unknown) {
  if (!Array.isArray(termsJson)) return []
  const EVERGREEN = new Date(Date.UTC(9999, 11, 31))
  const EPOCH = new Date(Date.UTC(1970, 0, 1))
  // Mirrors lib/actions/pending-contracts.ts (Bug 4).
  const defaultRebateMethodForTermType = (tt: string): string => {
    switch (tt) {
      case "volume_rebate":
      case "growth_rebate":
        return "marginal"
      default:
        return "cumulative"
    }
  }
  // Mirrors lib/actions/pending-contracts.ts (Bug 3).
  const isVolumeColumnTermType = (tt: string): boolean =>
    tt === "volume_rebate" ||
    tt === "rebate_per_use" ||
    tt === "capitated_pricing_rebate" ||
    tt === "po_rebate" ||
    tt === "payment_rebate"
  const isMarketShareColumnTermType = (tt: string): boolean =>
    tt === "compliance_rebate" || tt === "market_share"
  const out: Array<{
    termName: string
    termType: string
    baselineType: string
    rebateMethod: string
    spendBaseline: number | null
    growthBaselinePercent: number | null
    volumeBaseline: number | null
    desiredMarketShare: number | null
    volumeType: string | null
    scopedCategoryIds: string[]
    scopedItemNumbers: string[]
    cptCodes: string[]
    tiers: Array<{
      tierNumber: number
      spendMin: number
      spendMax: number | null
      volumeMin: number | null
      volumeMax: number | null
      marketShareMin: number | null
      marketShareMax: number | null
      rebateValue: number
      rebateType: string
    }>
    effectiveStart: Date
    effectiveEnd: Date
  }> = []
  for (const raw of termsJson) {
    if (!raw || typeof raw !== "object") continue
    const t = raw as Record<string, unknown>
    const termName = coerceString(t.termName)
    if (!termName) continue
    const termType = coerceString(t.termType) ?? "spend_rebate"
    const tiersRaw = Array.isArray(t.tiers) ? t.tiers : []
    const tiers = tiersRaw
      .map((rawTier, idx) => {
        if (!rawTier || typeof rawTier !== "object") return null
        const tier = rawTier as Record<string, unknown>
        const rawSpendMin = coerceNumber(tier.spendMin)
        const rawSpendMax =
          tier.spendMax === null || tier.spendMax === undefined
            ? null
            : coerceNumber(tier.spendMax)
        const rawVolumeMin =
          tier.volumeMin === null || tier.volumeMin === undefined
            ? null
            : coerceNumber(tier.volumeMin)
        const rawVolumeMax =
          tier.volumeMax === null || tier.volumeMax === undefined
            ? null
            : coerceNumber(tier.volumeMax)
        const rawMarketShareMin =
          tier.marketShareMin === null || tier.marketShareMin === undefined
            ? null
            : coerceNumber(tier.marketShareMin)
        const rawMarketShareMax =
          tier.marketShareMax === null || tier.marketShareMax === undefined
            ? null
            : coerceNumber(tier.marketShareMax)
        const rebateValue = coerceNumber(tier.rebateValue) ?? 0

        let spendMin = rawSpendMin ?? 0
        let spendMax = rawSpendMax
        if (
          isVolumeColumnTermType(termType) &&
          (rawSpendMin === null || rawSpendMin === 0) &&
          rawVolumeMin !== null &&
          rawVolumeMin !== undefined
        ) {
          spendMin = rawVolumeMin
          if (
            (spendMax === null || spendMax === undefined) &&
            rawVolumeMax !== null &&
            rawVolumeMax !== undefined
          ) {
            spendMax = rawVolumeMax
          }
        } else if (
          isMarketShareColumnTermType(termType) &&
          (rawSpendMin === null || rawSpendMin === 0) &&
          rawMarketShareMin !== null &&
          rawMarketShareMin !== undefined
        ) {
          spendMin = rawMarketShareMin
          if (
            (spendMax === null || spendMax === undefined) &&
            rawMarketShareMax !== null &&
            rawMarketShareMax !== undefined
          ) {
            spendMax = rawMarketShareMax
          }
        }

        return {
          tierNumber:
            typeof tier.tierNumber === "number" ? tier.tierNumber : idx + 1,
          spendMin,
          spendMax,
          volumeMin: rawVolumeMin,
          volumeMax: rawVolumeMax,
          marketShareMin: rawMarketShareMin,
          marketShareMax: rawMarketShareMax,
          rebateValue,
          rebateType: coerceString(tier.rebateType) ?? "percent_of_spend",
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const cptCodes = Array.isArray(t.cptCodes)
      ? (t.cptCodes
          .map((c) => coerceString(c))
          .filter((c): c is string => c !== null) as string[])
      : []
    const scopedCategoryIds = Array.isArray(t.scopedCategoryIds)
      ? (t.scopedCategoryIds
          .map((c) => coerceString(c))
          .filter((c): c is string => c !== null) as string[])
      : []
    const scopedItemNumbers = Array.isArray(t.scopedItemNumbers)
      ? (t.scopedItemNumbers
          .map((c) => coerceString(c))
          .filter((c): c is string => c !== null) as string[])
      : []
    out.push({
      termName,
      termType,
      baselineType: coerceString(t.baselineType) ?? "spend_based",
      rebateMethod:
        coerceString(t.rebateMethod) ?? defaultRebateMethodForTermType(termType),
      spendBaseline: coerceNumber(t.spendBaseline),
      growthBaselinePercent: coerceNumber(t.growthBaselinePercent),
      volumeBaseline: coerceNumber(t.volumeBaseline),
      desiredMarketShare: coerceNumber(t.desiredMarketShare),
      volumeType: coerceString(t.volumeType),
      scopedCategoryIds,
      scopedItemNumbers,
      cptCodes,
      tiers,
      effectiveStart: parseDateOr(t.effectiveStart, EPOCH),
      effectiveEnd: parseDateOr(t.effectiveEnd, EVERGREEN),
    })
  }
  return out
}

describe("extractPendingTerms — baseline + procedure round-trip", () => {
  it("growth_rebate term round-trips spendBaseline + growthBaselinePercent", () => {
    const out = extractPendingTerms([
      {
        termName: "Growth Rebate",
        termType: "growth_rebate",
        baselineType: "growth_based",
        spendBaseline: 100000,
        growthBaselinePercent: 5,
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            rebateValue: 0.02,
            rebateType: "percent_of_spend",
          },
        ],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.spendBaseline).toBe(100000)
    expect(out[0]!.growthBaselinePercent).toBe(5)
    expect(out[0]!.termType).toBe("growth_rebate")
  })

  it("round-trips cptCodes, defaulting to [] when absent", () => {
    const out = extractPendingTerms([
      {
        termName: "Procedure Rebate",
        termType: "spend_rebate",
        cptCodes: ["27447", 123, null, "  ", "27486"],
        tiers: [],
      },
      { termName: "Plain", tiers: [] },
    ])
    expect(out[0]!.cptCodes).toEqual(["27447", "27486"])
    expect(out[1]!.cptCodes).toEqual([])
  })

  it("coerces numeric strings for baselines (currency-formatted)", () => {
    const out = extractPendingTerms([
      {
        termName: "String baseline",
        spendBaseline: "$100,000",
        growthBaselinePercent: "5",
        tiers: [],
      },
    ])
    expect(out[0]!.spendBaseline).toBe(100000)
    expect(out[0]!.growthBaselinePercent).toBe(5)
  })
})

describe("extractPendingTerms — volume + market_share round-trip (B5)", () => {
  it("volume_rebate term round-trips volumeBaseline + per-tier volumeMin/Max", () => {
    const out = extractPendingTerms([
      {
        termName: "Volume Tier Rebate",
        termType: "volume_rebate",
        baselineType: "volume_based",
        volumeBaseline: 5000,
        volumeType: "product_category",
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            volumeMin: 0,
            volumeMax: 999,
            rebateType: "percent_of_spend",
            rebateValue: 0.01,
          },
          {
            tierNumber: 2,
            spendMin: 0,
            volumeMin: 1000,
            volumeMax: 4999,
            rebateType: "percent_of_spend",
            rebateValue: 0.02,
          },
          {
            tierNumber: 3,
            spendMin: 0,
            volumeMin: 5000,
            volumeMax: null,
            rebateType: "percent_of_spend",
            rebateValue: 0.03,
          },
        ],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.volumeBaseline).toBe(5000)
    expect(out[0]!.volumeType).toBe("product_category")
    expect(out[0]!.tiers).toHaveLength(3)
    expect(out[0]!.tiers[0]!.volumeMin).toBe(0)
    expect(out[0]!.tiers[0]!.volumeMax).toBe(999)
    expect(out[0]!.tiers[1]!.volumeMin).toBe(1000)
    expect(out[0]!.tiers[1]!.volumeMax).toBe(4999)
    expect(out[0]!.tiers[2]!.volumeMin).toBe(5000)
    expect(out[0]!.tiers[2]!.volumeMax).toBeNull()
  })

  it("market_share term round-trips desiredMarketShare + per-tier marketShareMin/Max", () => {
    const out = extractPendingTerms([
      {
        termName: "Market Share Rebate",
        termType: "market_share",
        baselineType: "market_share_based",
        desiredMarketShare: 0.6,
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            marketShareMin: 0,
            marketShareMax: 49.99,
            rebateType: "percent_of_spend",
            rebateValue: 0.01,
          },
          {
            tierNumber: 2,
            spendMin: 0,
            marketShareMin: 50,
            marketShareMax: 100,
            rebateType: "percent_of_spend",
            rebateValue: 0.03,
          },
        ],
      },
    ])
    expect(out[0]!.desiredMarketShare).toBe(0.6)
    expect(out[0]!.tiers[0]!.marketShareMin).toBe(0)
    expect(out[0]!.tiers[0]!.marketShareMax).toBe(49.99)
    expect(out[0]!.tiers[1]!.marketShareMin).toBe(50)
    expect(out[0]!.tiers[1]!.marketShareMax).toBe(100)
  })

  it("round-trips scopedCategoryIds + scopedItemNumbers (sanitized)", () => {
    const out = extractPendingTerms([
      {
        termName: "Scoped term",
        termType: "spend_rebate",
        scopedCategoryIds: ["cat_1", "cat_2", null, "  "],
        scopedItemNumbers: ["SKU-001", "SKU-002", 123],
        tiers: [],
      },
    ])
    expect(out[0]!.scopedCategoryIds).toEqual(["cat_1", "cat_2"])
    expect(out[0]!.scopedItemNumbers).toEqual(["SKU-001", "SKU-002"])
  })

  it("defaults volume/market-share fields to null when absent", () => {
    const out = extractPendingTerms([
      {
        termName: "Plain",
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            rebateValue: 0,
            rebateType: "percent_of_spend",
          },
        ],
      },
    ])
    expect(out[0]!.volumeBaseline).toBeNull()
    expect(out[0]!.desiredMarketShare).toBeNull()
    expect(out[0]!.volumeType).toBeNull()
    expect(out[0]!.scopedCategoryIds).toEqual([])
    expect(out[0]!.scopedItemNumbers).toEqual([])
    expect(out[0]!.tiers[0]!.volumeMin).toBeNull()
    expect(out[0]!.tiers[0]!.volumeMax).toBeNull()
    expect(out[0]!.tiers[0]!.marketShareMin).toBeNull()
    expect(out[0]!.tiers[0]!.marketShareMax).toBeNull()
  })

  it("coerces numeric strings for volume/market-share fields", () => {
    const out = extractPendingTerms([
      {
        termName: "String numerics",
        volumeBaseline: "5,000",
        desiredMarketShare: "0.6",
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            volumeMin: "1000",
            volumeMax: "4,999",
            marketShareMin: "50",
            marketShareMax: "100",
            rebateType: "percent_of_spend",
            rebateValue: 0,
          },
        ],
      },
    ])
    expect(out[0]!.volumeBaseline).toBe(5000)
    expect(out[0]!.desiredMarketShare).toBe(0.6)
    expect(out[0]!.tiers[0]!.volumeMin).toBe(1000)
    expect(out[0]!.tiers[0]!.volumeMax).toBe(4999)
    expect(out[0]!.tiers[0]!.marketShareMin).toBe(50)
    expect(out[0]!.tiers[0]!.marketShareMax).toBe(100)
  })
})

describe("extractPendingTerms — column-reuse mirroring (Bug 3)", () => {
  it("volume_rebate tier with only volumeMin mirrors into spendMin (engine reads spendMin as occurrence threshold)", () => {
    const out = extractPendingTerms([
      {
        termName: "Volume Tier Rebate",
        termType: "volume_rebate",
        baselineType: "volume_based",
        tiers: [
          {
            tierNumber: 1,
            volumeMin: 0,
            volumeMax: 99,
            rebateType: "fixed_rebate_per_unit",
            rebateValue: 1,
          },
          {
            tierNumber: 2,
            volumeMin: 100,
            volumeMax: 499,
            rebateType: "fixed_rebate_per_unit",
            rebateValue: 2,
          },
          {
            tierNumber: 3,
            volumeMin: 500,
            rebateType: "fixed_rebate_per_unit",
            rebateValue: 3,
          },
        ],
      },
    ])
    expect(out[0]!.tiers[0]!.spendMin).toBe(0)
    expect(out[0]!.tiers[0]!.spendMax).toBe(99)
    expect(out[0]!.tiers[1]!.spendMin).toBe(100)
    expect(out[0]!.tiers[1]!.spendMax).toBe(499)
    expect(out[0]!.tiers[2]!.spendMin).toBe(500)
    expect(out[0]!.tiers[2]!.spendMax).toBeNull()
    // Dedicated columns still preserved.
    expect(out[0]!.tiers[1]!.volumeMin).toBe(100)
    expect(out[0]!.tiers[1]!.volumeMax).toBe(499)
  })

  it("market_share tier with only marketShareMin mirrors into spendMin", () => {
    const out = extractPendingTerms([
      {
        termName: "Market Share Rebate",
        termType: "market_share",
        tiers: [
          {
            tierNumber: 1,
            marketShareMin: 0,
            marketShareMax: 49.99,
            rebateValue: 0.01,
          },
          {
            tierNumber: 2,
            marketShareMin: 50,
            marketShareMax: 100,
            rebateValue: 0.03,
          },
        ],
      },
    ])
    expect(out[0]!.tiers[0]!.spendMin).toBe(0)
    expect(out[0]!.tiers[0]!.spendMax).toBe(49.99)
    expect(out[0]!.tiers[1]!.spendMin).toBe(50)
    expect(out[0]!.tiers[1]!.spendMax).toBe(100)
    expect(out[0]!.tiers[1]!.marketShareMin).toBe(50)
  })

  it("does NOT clobber an explicitly-set spendMin (e.g. user set both)", () => {
    const out = extractPendingTerms([
      {
        termName: "Explicit spendMin wins",
        termType: "volume_rebate",
        tiers: [
          {
            tierNumber: 1,
            spendMin: 42,
            volumeMin: 999,
            rebateValue: 1,
          },
        ],
      },
    ])
    expect(out[0]!.tiers[0]!.spendMin).toBe(42)
    expect(out[0]!.tiers[0]!.volumeMin).toBe(999)
  })

  it("does NOT mirror for spend_rebate (column-reuse only applies to non-spend types)", () => {
    const out = extractPendingTerms([
      {
        termName: "Plain Spend",
        termType: "spend_rebate",
        tiers: [
          {
            tierNumber: 1,
            volumeMin: 1000,
            rebateValue: 0.02,
          },
        ],
      },
    ])
    expect(out[0]!.tiers[0]!.spendMin).toBe(0)
  })
})

describe("extractPendingTerms — rebateMethod default (Bug 4)", () => {
  it("defaults rebateMethod to 'marginal' for volume_rebate when omitted", () => {
    const out = extractPendingTerms([
      {
        termName: "Vol",
        termType: "volume_rebate",
        tiers: [],
      },
    ])
    expect(out[0]!.rebateMethod).toBe("marginal")
  })

  it("defaults rebateMethod to 'marginal' for growth_rebate when omitted", () => {
    const out = extractPendingTerms([
      {
        termName: "Grow",
        termType: "growth_rebate",
        tiers: [],
      },
    ])
    expect(out[0]!.rebateMethod).toBe("marginal")
  })

  it("defaults rebateMethod to 'cumulative' for spend_rebate", () => {
    const out = extractPendingTerms([
      {
        termName: "Spend",
        termType: "spend_rebate",
        tiers: [],
      },
    ])
    expect(out[0]!.rebateMethod).toBe("cumulative")
  })

  it("honors explicit rebateMethod even when termType-default would override", () => {
    const out = extractPendingTerms([
      {
        termName: "Vol cumulative explicit",
        termType: "volume_rebate",
        rebateMethod: "cumulative",
        tiers: [],
      },
    ])
    expect(out[0]!.rebateMethod).toBe("cumulative")
  })
})
