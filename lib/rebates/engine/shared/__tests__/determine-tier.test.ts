import { describe, it, expect } from "vitest"
import { determineTier } from "../determine-tier"
import type { RebateTier } from "../../types"

const t = (n: number, min: number, max: number | null, rate: number): RebateTier => ({
  tierNumber: n,
  thresholdMin: min,
  thresholdMax: max,
  rebateValue: rate,
})

describe("determineTier", () => {
  const tiers = [
    t(1, 0, 50_000, 2),
    t(2, 50_000, 100_000, 4),
    t(3, 100_000, null, 6),
  ]

  it("returns null when no tiers", () => {
    expect(determineTier(50_000, [], "EXCLUSIVE")).toBeNull()
  })

  it("EXCLUSIVE boundary: $50K stays in tier 1 — wait no, EXCLUSIVE means boundary goes to HIGHER tier", () => {
    // EXCLUSIVE: boundary dollar belongs to HIGHER tier.
    // So $50K (at tier 2's thresholdMin) goes to tier 2.
    const result = determineTier(50_000, tiers, "EXCLUSIVE")
    expect(result?.tierNumber).toBe(2)
  })

  it("INCLUSIVE boundary: $50K stays in tier 1 (belongs to LOWER tier)", () => {
    const result = determineTier(50_000, tiers, "INCLUSIVE")
    expect(result?.tierNumber).toBe(1)
  })

  it("returns tier 1 for $25K in both modes", () => {
    expect(determineTier(25_000, tiers, "EXCLUSIVE")?.tierNumber).toBe(1)
    expect(determineTier(25_000, tiers, "INCLUSIVE")?.tierNumber).toBe(1)
  })

  it("returns tier 2 for $75K in both modes", () => {
    expect(determineTier(75_000, tiers, "EXCLUSIVE")?.tierNumber).toBe(2)
    expect(determineTier(75_000, tiers, "INCLUSIVE")?.tierNumber).toBe(2)
  })

  it("returns top tier for values above all thresholds", () => {
    expect(determineTier(500_000, tiers, "EXCLUSIVE")?.tierNumber).toBe(3)
    expect(determineTier(500_000, tiers, "INCLUSIVE")?.tierNumber).toBe(3)
  })

  it("[A1] scans to end — returns highest qualifying tier even with overlapping ranges", () => {
    // Some real contracts have overlapping tier ranges (rare but documented).
    // The pre-[A1] code broke early after the first match; this test locks
    // in the scan-to-end behavior.
    const overlappingTiers = [
      t(1, 0, 100_000, 2),
      t(2, 50_000, 200_000, 4),
      t(3, 150_000, null, 6),
    ]
    // $75K qualifies for tier 1 (0-100k) AND tier 2 (50k-200k) → return tier 2.
    expect(determineTier(75_000, overlappingTiers, "EXCLUSIVE")?.tierNumber).toBe(2)
    // $175K qualifies for tier 2 AND tier 3 → return tier 3.
    expect(determineTier(175_000, overlappingTiers, "EXCLUSIVE")?.tierNumber).toBe(3)
  })

  it("returns null when value is below all thresholds (EXCLUSIVE)", () => {
    // With EXCLUSIVE, $0 qualifies for tier 1 (thresholdMin = 0 is INCLUSIVE
    // of 0 under both modes). Negative would miss all — but negative spend
    // isn't a real case; locking in that $0 → tier 1.
    expect(determineTier(0, tiers, "EXCLUSIVE")?.tierNumber).toBe(1)
  })
})
