import { describe, it, expect } from "vitest"
import { isPlaceholderCategory } from "@/lib/categories/resolve"

describe("isPlaceholderCategory (bug 5)", () => {
  it("treats numeric / placeholder junk as not-a-category", () => {
    for (const s of ["0", "0.0", "123", "-", "—", "  0 ", "N/A", "n/a", "none", "null", "TBD", ""]) {
      expect(isPlaceholderCategory(s)).toBe(true)
    }
  })
  it("keeps real category names", () => {
    for (const s of ["Ortho-Joints", "Biologics", "Joints-Ortho", "Supplies & Materials", "Sutures"]) {
      expect(isPlaceholderCategory(s)).toBe(false)
    }
  })
})
