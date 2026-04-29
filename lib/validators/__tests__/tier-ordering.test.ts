/**
 * Charles 2026-04-28 Bug #3: tier-ordering validator was too strict.
 * The natural pattern "Tier 1: $0-$50K, Tier 2: $50K-∞" was rejected
 * even though neither rebate engine double-counts at the boundary.
 * These tests pin the relaxed semantics:
 *   - boundary equality (cur.spendMin == prev.spendMax) is OK
 *   - strict overlap (cur.spendMin < prev.spendMax) is rejected
 */
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { refineTierOrdering } from "../contract-terms"

function validate(
  tiers: Array<{
    tierNumber: number
    spendMin: number
    spendMax?: number | null
    volumeMin?: number | null
    volumeMax?: number | null
    marketShareMin?: number | null
    marketShareMax?: number | null
  }>,
): z.ZodIssue[] {
  const issues: z.ZodIssue[] = []
  const ctx = {
    addIssue: (issue: z.ZodIssue) => issues.push(issue),
  } as unknown as z.RefinementCtx
  // Defaults to satisfy TierInput shape.
  refineTierOrdering(
    tiers.map((t) => ({
      tierNumber: t.tierNumber,
      spendMin: t.spendMin,
      spendMax: t.spendMax ?? null,
      volumeMin: t.volumeMin ?? null,
      volumeMax: t.volumeMax ?? null,
      marketShareMin: t.marketShareMin ?? null,
      marketShareMax: t.marketShareMax ?? null,
    })) as Parameters<typeof refineTierOrdering>[0],
    ctx,
  )
  return issues
}

describe("refineTierOrdering — Charles Bug #3 relaxation", () => {
  it("ALLOWS adjacent boundaries: Tier 1 $0-$50K, Tier 2 $50K-∞", () => {
    const issues = validate([
      { tierNumber: 1, spendMin: 0, spendMax: 50_000 },
      { tierNumber: 2, spendMin: 50_000, spendMax: null },
    ])
    expect(issues).toEqual([])
  })

  it("REJECTS strict overlap: Tier 1 $0-$50K, Tier 2 $40K-∞", () => {
    const issues = validate([
      { tierNumber: 1, spendMin: 0, spendMax: 50_000 },
      { tierNumber: 2, spendMin: 40_000, spendMax: null },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toEqual(["tiers", 1, "spendMin"])
  })

  it("ALLOWS the +1 convention: Tier 1 $0-$49,999, Tier 2 $50K-∞", () => {
    const issues = validate([
      { tierNumber: 1, spendMin: 0, spendMax: 49_999 },
      { tierNumber: 2, spendMin: 50_000, spendMax: null },
    ])
    expect(issues).toEqual([])
  })

  it("ALLOWS adjacent volume boundaries", () => {
    const issues = validate([
      { tierNumber: 1, spendMin: 0, volumeMin: 0, volumeMax: 100 },
      { tierNumber: 2, spendMin: 0, volumeMin: 100, volumeMax: 200 },
    ])
    expect(issues).toEqual([])
  })

  it("ALLOWS adjacent market-share boundaries", () => {
    const issues = validate([
      { tierNumber: 1, spendMin: 0, marketShareMin: 0, marketShareMax: 30 },
      { tierNumber: 2, spendMin: 0, marketShareMin: 30, marketShareMax: 60 },
    ])
    expect(issues).toEqual([])
  })

  it("REJECTS strict market-share overlap", () => {
    const issues = validate([
      { tierNumber: 1, spendMin: 0, marketShareMin: 0, marketShareMax: 30 },
      { tierNumber: 2, spendMin: 0, marketShareMin: 25, marketShareMax: 60 },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toEqual(["tiers", 1, "marketShareMin"])
  })
})
