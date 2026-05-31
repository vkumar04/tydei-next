import { describe, it, expect } from "vitest"
import {
  sanitizePricingRow,
  normalizeCarveOutPercent,
} from "@/lib/contracts/pricing-row-sanitize"
import type { ContractPricingItem } from "@/lib/actions/pricing-files-types"

function item(overrides: Partial<ContractPricingItem>): ContractPricingItem {
  return { vendorItemNo: "ABC-1", unitPrice: 10, ...overrides }
}

describe("normalizeCarveOutPercent", () => {
  it("keeps a sane fraction as-is", () => {
    expect(normalizeCarveOutPercent(0.03)).toBe(0.03)
  })

  it("normalizes percent-points (>1) into a fraction — the carve-out-file overflow case", () => {
    // A carve-out file supplying 30 (meaning 30%) would overflow the
    // Decimal(5,4) column (max 9.9999) and roll back the whole batch.
    expect(normalizeCarveOutPercent(30)).toBeCloseTo(0.3, 10)
  })

  it("drops non-finite values to null", () => {
    expect(normalizeCarveOutPercent(NaN)).toBeNull()
    expect(normalizeCarveOutPercent(undefined)).toBeNull()
    expect(normalizeCarveOutPercent(null)).toBeNull()
  })

  it("drops values still out of the Decimal(5,4) range after normalization", () => {
    // 100000 → /100 = 1000, still > 9.9999 → null (would overflow).
    expect(normalizeCarveOutPercent(100000)).toBeNull()
    expect(normalizeCarveOutPercent(-0.5)).toBeNull()
  })
})

describe("sanitizePricingRow", () => {
  it("coerces a NaN unitPrice to 0 so the row still imports", () => {
    expect(sanitizePricingRow(item({ unitPrice: NaN })).unitPrice).toBe(0)
  })

  it("nulls a NaN or missing listPrice", () => {
    expect(sanitizePricingRow(item({ listPrice: NaN })).listPrice).toBeNull()
    expect(sanitizePricingRow(item({})).listPrice).toBeNull()
  })

  it("preserves a valid listPrice", () => {
    expect(sanitizePricingRow(item({ listPrice: 42.5 })).listPrice).toBe(42.5)
  })

  it("defaults uom to EA", () => {
    expect(sanitizePricingRow(item({})).uom).toBe("EA")
    expect(sanitizePricingRow(item({ uom: "BX" })).uom).toBe("BX")
  })

  it("nulls an unparseable date instead of producing Invalid Date", () => {
    const row = sanitizePricingRow(
      item({ effectiveDate: "TBD", expirationDate: "not-a-date" }),
    )
    expect(row.effectiveDate).toBeNull()
    expect(row.expirationDate).toBeNull()
  })

  it("parses a valid ISO date", () => {
    const row = sanitizePricingRow(item({ effectiveDate: "2026-01-05" }))
    expect(row.effectiveDate).toBeInstanceOf(Date)
    expect(row.effectiveDate?.getUTCFullYear()).toBe(2026)
  })

  it("normalizes carveOutPercent through the same overflow guard", () => {
    expect(sanitizePricingRow(item({ carveOutPercent: 30 })).carveOutPercent).toBeCloseTo(
      0.3,
      10,
    )
    expect(sanitizePricingRow(item({ carveOutPercent: undefined })).carveOutPercent).toBeNull()
  })
})
