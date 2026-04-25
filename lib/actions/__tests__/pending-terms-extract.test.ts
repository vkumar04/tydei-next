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
  const out: Array<{
    termName: string
    termType: string
    baselineType: string
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
    const tiersRaw = Array.isArray(t.tiers) ? t.tiers : []
    const tiers = tiersRaw
      .map((rawTier, idx) => {
        if (!rawTier || typeof rawTier !== "object") return null
        const tier = rawTier as Record<string, unknown>
        const spendMin = coerceNumber(tier.spendMin) ?? 0
        const rebateValue = coerceNumber(tier.rebateValue) ?? 0
        return {
          tierNumber:
            typeof tier.tierNumber === "number" ? tier.tierNumber : idx + 1,
          spendMin,
          spendMax:
            tier.spendMax === null || tier.spendMax === undefined
              ? null
              : coerceNumber(tier.spendMax),
          volumeMin:
            tier.volumeMin === null || tier.volumeMin === undefined
              ? null
              : coerceNumber(tier.volumeMin),
          volumeMax:
            tier.volumeMax === null || tier.volumeMax === undefined
              ? null
              : coerceNumber(tier.volumeMax),
          marketShareMin:
            tier.marketShareMin === null || tier.marketShareMin === undefined
              ? null
              : coerceNumber(tier.marketShareMin),
          marketShareMax:
            tier.marketShareMax === null || tier.marketShareMax === undefined
              ? null
              : coerceNumber(tier.marketShareMax),
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
      termType: coerceString(t.termType) ?? "spend_rebate",
      baselineType: coerceString(t.baselineType) ?? "spend_based",
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
