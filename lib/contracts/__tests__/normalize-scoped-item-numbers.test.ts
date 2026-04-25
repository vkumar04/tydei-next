import { describe, it, expect } from "vitest"
import { normalizeScopedItemNumbers } from "@/lib/contracts/normalize-scoped-item-numbers"

describe("normalizeScopedItemNumbers", () => {
  it("dedupes case-sensitive duplicates", () => {
    expect(normalizeScopedItemNumbers(["A", "B", "A"])).toEqual(["A", "B"])
  })

  it("trims whitespace then dedupes", () => {
    expect(normalizeScopedItemNumbers(["A", " A ", "A "])).toEqual(["A"])
  })

  it("drops empty + whitespace-only entries", () => {
    expect(normalizeScopedItemNumbers(["A", "", "  ", "B"])).toEqual(["A", "B"])
  })

  it("handles null / undefined", () => {
    expect(normalizeScopedItemNumbers(null)).toEqual([])
    expect(normalizeScopedItemNumbers(undefined)).toEqual([])
    expect(normalizeScopedItemNumbers([])).toEqual([])
  })

  it("preserves first-seen order", () => {
    expect(normalizeScopedItemNumbers(["C", "A", "B", "A", "C"])).toEqual([
      "C",
      "A",
      "B",
    ])
  })
})
