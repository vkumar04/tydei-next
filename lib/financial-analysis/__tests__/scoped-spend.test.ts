import { describe, it, expect } from "vitest"
import { computeScopedSpendFraction } from "../scoped-spend"

const ROWS = [
  { category: "Spine", vendor: "Acme", spend: 400 },
  { category: "Spine", vendor: "Beta", spend: 100 },
  { category: "Trauma", vendor: "Acme", spend: 300 },
  { category: "Trauma", vendor: "Beta", spend: 200 },
] // total 1000

describe("computeScopedSpendFraction", () => {
  it("null selection = everything → 1", () => {
    expect(computeScopedSpendFraction(ROWS, null, null)).toBe(1)
  })

  it("intersection of category AND vendor", () => {
    // Spine ∩ Acme = 400 of 1000
    expect(
      computeScopedSpendFraction(ROWS, new Set(["Spine"]), new Set(["Acme"])),
    ).toBeCloseTo(0.4, 5)
  })

  it("category-only selection sums across its vendors", () => {
    // Spine = 400 + 100 = 500
    expect(
      computeScopedSpendFraction(ROWS, new Set(["Spine"]), null),
    ).toBeCloseTo(0.5, 5)
  })

  it("vendor-only selection sums across its categories", () => {
    // Acme = 400 + 300 = 700
    expect(
      computeScopedSpendFraction(ROWS, null, new Set(["Acme"])),
    ).toBeCloseTo(0.7, 5)
  })

  it("empty selection sets → 0", () => {
    expect(computeScopedSpendFraction(ROWS, new Set(), new Set())).toBe(0)
  })

  it("empty matrix → 1 (treat as all)", () => {
    expect(computeScopedSpendFraction([], new Set(["x"]), null)).toBe(1)
  })
})
