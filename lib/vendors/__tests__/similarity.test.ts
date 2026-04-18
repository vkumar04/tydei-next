import { describe, it, expect } from "vitest"
import {
  levenshtein,
  similarityRatio,
  normalizeVendorName,
  proposeVendorMatches,
  type VendorCandidate,
} from "../similarity"

describe("levenshtein", () => {
  it("computes classic kitten → sitting edit distance of 3", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3)
  })

  it("returns target length when source is empty", () => {
    expect(levenshtein("", "abc")).toBe(3)
  })

  it("returns source length when target is empty", () => {
    expect(levenshtein("abc", "")).toBe(3)
  })

  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0)
  })

  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0)
  })
})

describe("similarityRatio", () => {
  it("returns 1 for identical strings", () => {
    expect(similarityRatio("Acme", "Acme")).toBe(1)
  })

  it("is case-insensitive", () => {
    expect(similarityRatio("ACME", "acme")).toBe(1)
  })

  it("returns raw levenshtein-based ratio for 'Acme' vs 'Acme Corp' (~0.44)", () => {
    // distance = 5 (append " corp"), max length = 9 → 1 - 5/9 ≈ 0.4444
    const ratio = similarityRatio("Acme", "Acme Corp")
    expect(ratio).toBeCloseTo(0.4444, 3)
  })

  it("returns 1 when both strings are empty", () => {
    expect(similarityRatio("", "")).toBe(1)
  })

  it("returns 0 when only one string is empty", () => {
    expect(similarityRatio("", "abc")).toBe(0)
    expect(similarityRatio("abc", "")).toBe(0)
  })
})

describe("normalizeVendorName", () => {
  it("strips corp, inc, and punctuation from 'Acme Corp, Inc.'", () => {
    expect(normalizeVendorName("Acme Corp, Inc.")).toBe("acme")
  })

  it("strips trailing LLC from 'Stryker Orthopaedics LLC'", () => {
    expect(normalizeVendorName("Stryker Orthopaedics LLC")).toBe("stryker orthopaedics")
  })

  it("collapses internal whitespace and lowercases", () => {
    expect(normalizeVendorName("  Medtronic   PLC  ")).toBe("medtronic plc")
  })

  it("collapses whitespace introduced by punctuation stripping", () => {
    // '&' is treated as punctuation → space, then whitespace collapses
    expect(normalizeVendorName("Johnson & Johnson")).toBe("johnson johnson")
  })
})

describe("proposeVendorMatches", () => {
  const candidates: VendorCandidate[] = [
    { id: "v1", name: "Stryker Orthopaedics" },
    { id: "v2", name: "Medtronic", aliases: ["Medtronic PLC", "Medtronic USA"] },
    { id: "v3", name: "Zimmer Biomet" },
    { id: "v4", name: "Johnson & Johnson" },
  ]

  it("returns confidence 1 for an exact (post-normalize) match", () => {
    const [top] = proposeVendorMatches("Stryker Orthopaedics LLC", candidates)
    expect(top.candidate.id).toBe("v1")
    expect(top.confidence).toBe(1)
    expect(top.reason).toBe("name match")
  })

  it("matches via alias and reports 'alias match' as the reason", () => {
    const [top] = proposeVendorMatches("Medtronic USA", candidates)
    expect(top.candidate.id).toBe("v2")
    expect(top.reason).toContain("alias")
    expect(top.confidence).toBe(1)
  })

  it("filters out candidates below minConfidence", () => {
    const results = proposeVendorMatches("Totally Unrelated Vendor", candidates, {
      minConfidence: 0.9,
    })
    expect(results).toEqual([])
  })

  it("caps results to topN", () => {
    // Many similarly-named candidates — expect topN=2 enforcement
    const many: VendorCandidate[] = [
      { id: "a1", name: "Acme" },
      { id: "a2", name: "Acme" },
      { id: "a3", name: "Acme" },
      { id: "a4", name: "Acme" },
    ]
    const results = proposeVendorMatches("Acme", many, { topN: 2 })
    expect(results).toHaveLength(2)
  })

  it("breaks confidence ties by candidate.id ascending (stable)", () => {
    const tied: VendorCandidate[] = [
      { id: "zzz", name: "Acme" },
      { id: "aaa", name: "Acme" },
      { id: "mmm", name: "Acme" },
    ]
    const results = proposeVendorMatches("Acme", tied)
    expect(results.map((r) => r.candidate.id)).toEqual(["aaa", "mmm", "zzz"])
  })

  it("returns empty array for empty input", () => {
    expect(proposeVendorMatches("", candidates)).toEqual([])
  })

  it("defaults minConfidence to 0.7", () => {
    // "Stryker" vs normalized "stryker orthopaedics" — similarity below 0.7
    const results = proposeVendorMatches("Stryker", candidates)
    // The default threshold should exclude the partial match on v1
    const stryker = results.find((r) => r.candidate.id === "v1")
    expect(stryker).toBeUndefined()
  })

  it("defaults topN to 5", () => {
    const many: VendorCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      name: "Acme",
    }))
    const results = proposeVendorMatches("Acme", many)
    expect(results).toHaveLength(5)
  })
})
