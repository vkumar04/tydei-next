import { describe, it, expect } from "vitest"
import { applyCategoryRemap } from "@/lib/categories/apply-category-remap"

describe("applyCategoryRemap", () => {
  it("remaps a raw category present in the map", () => {
    expect(applyCategoryRemap("Ortho", { Ortho: "Orthopedics" })).toBe(
      "Orthopedics",
    )
  })

  it("trims the raw category before lookup", () => {
    expect(applyCategoryRemap("Ortho ", { Ortho: "Orthopedics" })).toBe(
      "Orthopedics",
    )
  })

  it("returns the original when the raw category is not in the map", () => {
    expect(applyCategoryRemap("Unknown", { Ortho: "Orthopedics" })).toBe(
      "Unknown",
    )
  })

  it("returns null unchanged", () => {
    expect(applyCategoryRemap(null, { Ortho: "Orthopedics" })).toBeNull()
  })

  it("ignores an empty-string target (falls through to original)", () => {
    expect(applyCategoryRemap("Ortho", { Ortho: "" })).toBe("Ortho")
  })
})
