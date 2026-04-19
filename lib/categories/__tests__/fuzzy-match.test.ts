import { describe, it, expect } from "vitest"
import { suggestSimilarCategory } from "../fuzzy-match"

const existing = [
  { id: "c1", name: "Trauma" },
  { id: "c2", name: "Orthopedics" },
  { id: "c3", name: "Cardiology" },
  { id: "c4", name: "Spine" },
]

describe("suggestSimilarCategory", () => {
  it("suggests existing 'Trauma' when user types 'Trauma Implants'", () => {
    const hit = suggestSimilarCategory("Trauma Implants", existing)
    expect(hit?.id).toBe("c1")
    expect(hit?.name).toBe("Trauma")
  })

  it("suggests existing 'Orthopedics' when user types 'Ortho'", () => {
    const hit = suggestSimilarCategory("Ortho", existing)
    expect(hit?.id).toBe("c2")
  })

  it("suggests within Levenshtein <= 2 (typo)", () => {
    const hit = suggestSimilarCategory("Cardioligy", existing)
    expect(hit?.id).toBe("c3")
  })

  it("returns null for exact match (case-insensitive)", () => {
    expect(suggestSimilarCategory("trauma", existing)).toBeNull()
    expect(suggestSimilarCategory("SPINE", existing)).toBeNull()
  })

  it("returns null for unrelated names", () => {
    expect(suggestSimilarCategory("Pharmaceuticals", existing)).toBeNull()
    expect(suggestSimilarCategory("Laboratory", existing)).toBeNull()
  })

  it("returns null for very short input", () => {
    expect(suggestSimilarCategory("ab", existing)).toBeNull()
  })

  it("returns null when no existing categories", () => {
    expect(suggestSimilarCategory("Trauma", [])).toBeNull()
  })
})
