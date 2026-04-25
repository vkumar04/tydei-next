/**
 * Unit tests for the pending-terms extractor in
 * `lib/actions/pending-contracts.ts`. The action lives behind a
 * `"use server"` boundary, so (matching `pending-pricing-extract.test.ts`)
 * we re-implement the extractor inline and lock in its behavior.
 *
 * Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B3): the
 * baseline + cptCodes branches are the new behavior; without them
 * growth/volume/CPT contracts compute against undefined baselines on
 * the engine and silently produce $0.
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
    cptCodes: string[]
    tiers: Array<{
      tierNumber: number
      spendMin: number
      spendMax: number | null
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
    out.push({
      termName,
      termType: coerceString(t.termType) ?? "spend_rebate",
      baselineType: coerceString(t.baselineType) ?? "spend_based",
      spendBaseline: coerceNumber(t.spendBaseline),
      growthBaselinePercent: coerceNumber(t.growthBaselinePercent),
      cptCodes,
      tiers,
      effectiveStart: parseDateOr(t.effectiveStart, EPOCH),
      effectiveEnd: parseDateOr(t.effectiveEnd, EVERGREEN),
    })
  }
  return out
}

describe("extractPendingTerms — baseline + procedure round-trip", () => {
  it("growth_rebate term round-trips spendBaseline", () => {
    const out = extractPendingTerms([
      {
        termName: "Growth Rebate",
        termType: "growth_rebate",
        baselineType: "growth_based",
        spendBaseline: 100000,
        tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 0.02 }],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.spendBaseline).toBe(100000)
    expect(out[0]!.termType).toBe("growth_rebate")
  })

  it("growth_rebate term round-trips growthBaselinePercent", () => {
    const out = extractPendingTerms([
      {
        termName: "Growth Rebate",
        termType: "growth_rebate",
        growthBaselinePercent: 5,
        tiers: [],
      },
    ])
    expect(out[0]!.growthBaselinePercent).toBe(5)
  })

  it("volume_rebate term round-trips cptCodes", () => {
    const out = extractPendingTerms([
      {
        termName: "Volume Rebate",
        termType: "volume_rebate",
        cptCodes: ["27447", "27486"],
        tiers: [],
      },
    ])
    expect(out[0]!.cptCodes).toEqual(["27447", "27486"])
  })

  it("defaults baselines to null and cptCodes to [] when absent", () => {
    const out = extractPendingTerms([
      { termName: "Plain spend term", tiers: [] },
    ])
    expect(out[0]!.spendBaseline).toBeNull()
    expect(out[0]!.growthBaselinePercent).toBeNull()
    expect(out[0]!.cptCodes).toEqual([])
  })

  it("ignores non-string entries in cptCodes", () => {
    const out = extractPendingTerms([
      {
        termName: "Mixed CPT",
        cptCodes: ["27447", 123, null, "  ", "27486"],
        tiers: [],
      },
    ])
    expect(out[0]!.cptCodes).toEqual(["27447", "27486"])
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
