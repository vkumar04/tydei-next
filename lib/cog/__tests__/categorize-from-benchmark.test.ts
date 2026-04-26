import { describe, it, expect } from "vitest"
import { inferCategoryFromBenchmark } from "@/lib/cog/categorize-from-benchmark"

describe("inferCategoryFromBenchmark", () => {
  const benchmarks = new Map<string, string>([
    ["ITEM-A", "Joint Replacement"],
    ["ITEM-B", "Spine"],
  ])

  it("returns the benchmark category when a match exists and current category is null", () => {
    const result = inferCategoryFromBenchmark(
      { currentCategory: null, vendorItemNo: "ITEM-A" },
      benchmarks
    )
    expect(result).toBe("Joint Replacement")
  })

  it("returns null when no benchmark match exists", () => {
    const result = inferCategoryFromBenchmark(
      { currentCategory: null, vendorItemNo: "ITEM-UNKNOWN" },
      benchmarks
    )
    expect(result).toBeNull()
  })

  it("does NOT return a category for rows that already have one set", () => {
    const result = inferCategoryFromBenchmark(
      { currentCategory: "Manually Tagged", vendorItemNo: "ITEM-A" },
      benchmarks
    )
    expect(result).toBeNull()
  })

  it("returns null when row has no vendorItemNo", () => {
    const result = inferCategoryFromBenchmark(
      { currentCategory: null, vendorItemNo: null },
      benchmarks
    )
    expect(result).toBeNull()
  })

  it("treats an empty-string current category as fillable", () => {
    const result = inferCategoryFromBenchmark(
      { currentCategory: "", vendorItemNo: "ITEM-B" },
      benchmarks
    )
    expect(result).toBe("Spine")
  })
})
