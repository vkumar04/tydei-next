import { describe, it, expect } from "vitest"
import { findFuzzyDuplicates, type CogRowFingerprint } from "@/lib/cog/ai-dedup"

const base = (over: Partial<CogRowFingerprint>): CogRowFingerprint => ({
  id: "x",
  vendorItemNo: "STK-1",
  description: "Stryker plate, 6-hole",
  transactionDate: new Date("2026-04-01"),
  extendedPrice: 100,
  ...over,
})

describe("findFuzzyDuplicates", () => {
  it("flags borderline pair (same item, close date, close price)", () => {
    const rows = [
      base({ id: "a" }),
      base({ id: "b", transactionDate: new Date("2026-04-04"), extendedPrice: 102 }),
    ]
    const pairs = findFuzzyDuplicates(rows)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reasons.length).toBeGreaterThanOrEqual(2)
  })

  it("ignores far-apart rows", () => {
    const rows = [
      base({ id: "a" }),
      base({ id: "b", transactionDate: new Date("2026-09-01"), extendedPrice: 500 }),
    ]
    const pairs = findFuzzyDuplicates(rows)
    expect(pairs).toHaveLength(0)
  })

  it("skips exact-duplicate pairs (deterministic detector handles those)", () => {
    const rows = [base({ id: "a" }), base({ id: "b" })]
    const pairs = findFuzzyDuplicates(rows)
    expect(pairs).toHaveLength(0)
  })
})
