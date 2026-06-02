/**
 * Bug 1/10 follow-up (Vick 2026-06-02): the Category Mapping dialog
 * pre-proposes a canonical target for unmapped categories so the user
 * confirms instead of typing. These are the REAL Arthrex price-file
 * categories vs the seeded ProductCategory names.
 */
import { describe, it, expect } from "vitest"
import { scoreCategoryMatch } from "@/lib/categories/category-suggest"

describe("scoreCategoryMatch — auto-suggest mappings (Bug 1/10)", () => {
  const best = (raw: string, names: string[]) =>
    names
      .map((n) => ({ n, s: scoreCategoryMatch(raw, n) }))
      .sort((a, b) => b.s - a.s)[0]

  const CANON = [
    "Sports Medicine",
    "Joint Replacement",
    "Trauma",
    "Spine",
    "Biologics",
    "Arthroscopy",
  ]

  it("maps real price-file categories to the right canonical name", () => {
    expect(best("Ortho-Sports Med", CANON).n).toBe("Sports Medicine")
    expect(best("Joints-Ortho", CANON).n).toBe("Joint Replacement")
    expect(best("Extremities & Trauma", CANON).n).toBe("Trauma")
  })

  it("scores a clear match above the 0.5 suggestion threshold", () => {
    expect(scoreCategoryMatch("Ortho-Sports Med", "Sports Medicine")).toBeGreaterThanOrEqual(0.5)
    expect(scoreCategoryMatch("Joints-Ortho", "Joint Replacement")).toBeGreaterThanOrEqual(0.5)
  })

  it("does not match unrelated categories", () => {
    expect(scoreCategoryMatch("Joints-Ortho", "Biologics")).toBe(0)
    expect(scoreCategoryMatch("Ortho-Sports Med", "Spine")).toBe(0)
  })
})
