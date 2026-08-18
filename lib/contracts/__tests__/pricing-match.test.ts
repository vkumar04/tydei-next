import { describe, it, expect } from "vitest"
import {
  matchProposedPricing,
  summarizePricingMatch,
  type ExistingPricingRow,
} from "@/lib/contracts/pricing-match"

/**
 * The single owner of "is this proposed row a new SKU or a reprice".
 *
 * Matching on raw `===` under-counts, because SKUs differ by case and stray
 * whitespace across vendor exports — the same class of bug CLAUDE.md calls out
 * for category names. A missed match reads as "new item" and silently
 * duplicates a SKU the contract already carries at a different price.
 */

const existing: ExistingPricingRow[] = [
  { id: "e1", vendorItemNo: "ABC-100", description: "Knee stem", category: "Implants", unitPrice: 1_000 },
  { id: "e2", vendorItemNo: "XYZ-200", description: "Hip cup", category: "Implants", unitPrice: "250.50" },
]

describe("matchProposedPricing", () => {
  it("classifies an unseen SKU as an add", () => {
    const r = matchProposedPricing(
      [{ vendorItemNo: "NEW-1", unitPrice: 42 }],
      existing,
    )
    expect(r.added).toHaveLength(1)
    expect(r.added[0]!.oldPrice).toBeNull()
    expect(r.added[0]!.existingId).toBeNull()
  })

  it("classifies a changed price as an update with the delta", () => {
    const r = matchProposedPricing(
      [{ vendorItemNo: "ABC-100", unitPrice: 1_100 }],
      existing,
    )
    expect(r.updated).toHaveLength(1)
    const c = r.updated[0]!
    expect(c.existingId).toBe("e1")
    expect(c.oldPrice).toBe(1_000)
    expect(c.delta).toBe(100)
    expect(c.deltaPercent).toBeCloseTo(0.1, 10)
  })

  it("REGRESSION: matches SKUs that differ only by case or whitespace", () => {
    // Raw === would call each of these a NEW item and duplicate the SKU.
    const r = matchProposedPricing(
      [
        { vendorItemNo: "abc-100", unitPrice: 1_100 },
        { vendorItemNo: " XYZ-200 ", unitPrice: 300 },
      ],
      existing,
    )
    expect(r.added).toHaveLength(0)
    expect(r.updated).toHaveLength(2)
    expect(r.updated.map((c) => c.existingId).sort()).toEqual(["e1", "e2"])
  })

  it("treats an identical price as unchanged, at cent precision", () => {
    const r = matchProposedPricing(
      [
        { vendorItemNo: "ABC-100", unitPrice: 1_000 },
        // Existing is the string "250.50" — Decimal columns arrive as strings.
        { vendorItemNo: "XYZ-200", unitPrice: 250.5 },
      ],
      existing,
    )
    expect(r.unchanged).toHaveLength(2)
    expect(r.updated).toHaveLength(0)
  })

  it("does not treat float dust as a price change", () => {
    const r = matchProposedPricing(
      [{ vendorItemNo: "ABC-100", unitPrice: 1_000 + 1e-9 }],
      existing,
    )
    expect(r.unchanged).toHaveLength(1)
  })

  it("flags a category conflict without blocking the match", () => {
    const r = matchProposedPricing(
      [{ vendorItemNo: "ABC-100", category: "Disposables", unitPrice: 1_200 }],
      existing,
    )
    expect(r.updated).toHaveLength(1)
    expect(r.updated[0]!.categoryConflict).toEqual({
      existing: "Implants",
      proposed: "Disposables",
    })
  })

  it("does not flag a conflict for equivalent category spellings", () => {
    const r = matchProposedPricing(
      [{ vendorItemNo: "ABC-100", category: "implant", unitPrice: 1_200 }],
      existing,
    )
    expect(r.updated[0]!.categoryConflict).toBeNull()
  })

  it("reports duplicate proposed SKUs — the last would silently win", () => {
    const r = matchProposedPricing(
      [
        { vendorItemNo: "DUP-1", unitPrice: 10 },
        { vendorItemNo: "dup-1", unitPrice: 20 },
      ],
      existing,
    )
    expect(r.duplicateSkus).toEqual(["dup-1"])
  })

  it("handles an empty contract and an empty proposal", () => {
    expect(matchProposedPricing([], existing).changes).toEqual([])
    const r = matchProposedPricing([{ vendorItemNo: "A", unitPrice: 1 }], [])
    expect(r.added).toHaveLength(1)
  })

  it("summarizes for the reviewer", () => {
    const r = matchProposedPricing(
      [
        { vendorItemNo: "NEW-1", unitPrice: 5 },
        { vendorItemNo: "ABC-100", unitPrice: 1_100 },
        { vendorItemNo: "XYZ-200", unitPrice: 250.5 },
      ],
      existing,
    )
    expect(summarizePricingMatch(r)).toBe("1 new · 1 repriced · 1 unchanged")
    expect(summarizePricingMatch(matchProposedPricing([], existing))).toBe(
      "No pricing items",
    )
  })
})
