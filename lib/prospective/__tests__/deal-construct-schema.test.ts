import { describe, it, expect } from "vitest"
import { z } from "zod"

import { dealConstructSchema } from "@/lib/prospective/deal-construct-schema"

/**
 * Guards the Deal-Scorer construct persistence shape — specifically that the
 * per-construct `category` survives the JSON-column write (Charles 2026-07-06
 * "categories not coming through"): a benchmark-only deal must be able to
 * carry a category, AND a payload without one must still validate (additive,
 * back-compat with proposals saved before the field existed).
 */
describe("dealConstructSchema", () => {
  const base = {
    benchmarkId: "bench-1",
    productName: "Cemented Knee",
    current: 4000,
    floor: 2850,
    target: 3300,
    ask: 3200,
    annualVolume: 670,
    rebatePercent: 2,
  }

  it("preserves a category through the write validation", () => {
    const parsed = dealConstructSchema.parse({ ...base, category: "Joint Replacement" })
    expect(parsed.category).toBe("Joint Replacement")
  })

  it("accepts a construct with NO category (optional / back-compat)", () => {
    const parsed = dealConstructSchema.parse(base)
    expect(parsed.category).toBeUndefined()
  })

  it("tolerates a free-text category not on any benchmark", () => {
    const parsed = dealConstructSchema.parse({ ...base, benchmarkId: null, category: "Custom Trays" })
    expect(parsed.category).toBe("Custom Trays")
  })

  it("array-parses a mix of categorized and uncategorized rows, dropping bad shapes", () => {
    const result = z
      .array(dealConstructSchema)
      .safeParse([
        { ...base, category: "Ortho" },
        { ...base },
        { productName: "broken" }, // missing numeric fields
      ])
    expect(result.success).toBe(false)

    const clean = z
      .array(dealConstructSchema)
      .safeParse([{ ...base, category: "Ortho" }, { ...base }])
    expect(clean.success).toBe(true)
    if (clean.success) {
      expect(clean.data[0]!.category).toBe("Ortho")
      expect(clean.data[1]!.category).toBeUndefined()
    }
  })
})
