import { describe, it, expect } from "vitest"
import {
  evaluatePurchaseCompliance,
  calculateComplianceRate,
  calculateMarketShare,
  type CompliancePurchase,
  type ComplianceContract,
} from "@/lib/contracts/compliance"

const today = new Date("2026-04-18")

const activeContract: ComplianceContract = {
  id: "c1",
  vendorId: "v1",
  effectiveDate: new Date("2026-01-01"),
  expirationDate: new Date("2026-12-31"),
  approvedItems: new Set(["SKU-A", "SKU-B"]),
  priceByItem: new Map([
    ["SKU-A", 100],
    ["SKU-B", 50],
  ]),
}

describe("evaluatePurchaseCompliance", () => {
  it("returns compliant = true for an on-contract purchase at contract price", () => {
    const purchase: CompliancePurchase = {
      vendorId: "v1",
      vendorItemNo: "SKU-A",
      unitPrice: 100,
      purchaseDate: new Date("2026-04-01"),
    }
    const result = evaluatePurchaseCompliance(purchase, [activeContract], today)
    expect(result.compliant).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it("flags off_contract when vendor has no active contract", () => {
    const purchase: CompliancePurchase = {
      vendorId: "v-other",
      vendorItemNo: "SKU-X",
      unitPrice: 10,
      purchaseDate: new Date("2026-04-01"),
    }
    const result = evaluatePurchaseCompliance(purchase, [activeContract], today)
    expect(result.compliant).toBe(false)
    expect(result.reasons).toContain("off_contract")
  })

  it("flags expired_contract when purchase is after expiration", () => {
    const expired: ComplianceContract = {
      ...activeContract,
      expirationDate: new Date("2026-03-01"),
    }
    const purchase: CompliancePurchase = {
      vendorId: "v1",
      vendorItemNo: "SKU-A",
      unitPrice: 100,
      purchaseDate: new Date("2026-04-01"),
    }
    const result = evaluatePurchaseCompliance(purchase, [expired], today)
    expect(result.compliant).toBe(false)
    expect(result.reasons).toContain("expired_contract")
  })

  it("flags unapproved_item when SKU is not in contract", () => {
    const purchase: CompliancePurchase = {
      vendorId: "v1",
      vendorItemNo: "SKU-ZZZ",
      unitPrice: 100,
      purchaseDate: new Date("2026-04-01"),
    }
    const result = evaluatePurchaseCompliance(purchase, [activeContract], today)
    expect(result.compliant).toBe(false)
    expect(result.reasons).toContain("unapproved_item")
  })

  it("flags price_variance when unit price exceeds contract by > 5%", () => {
    const purchase: CompliancePurchase = {
      vendorId: "v1",
      vendorItemNo: "SKU-A",
      unitPrice: 110, // 10% overcharge
      purchaseDate: new Date("2026-04-01"),
    }
    const result = evaluatePurchaseCompliance(purchase, [activeContract], today)
    expect(result.compliant).toBe(false)
    expect(result.reasons).toContain("price_variance")
  })

  it("does not flag price_variance for small under-price (undercharge)", () => {
    const purchase: CompliancePurchase = {
      vendorId: "v1",
      vendorItemNo: "SKU-A",
      unitPrice: 99, // 1% under
      purchaseDate: new Date("2026-04-01"),
    }
    const result = evaluatePurchaseCompliance(purchase, [activeContract], today)
    expect(result.reasons).not.toContain("price_variance")
  })
})

describe("calculateComplianceRate", () => {
  it("returns 100% when all purchases are compliant", () => {
    const purchases: CompliancePurchase[] = [
      { vendorId: "v1", vendorItemNo: "SKU-A", unitPrice: 100, purchaseDate: today },
      { vendorId: "v1", vendorItemNo: "SKU-B", unitPrice: 50, purchaseDate: today },
    ]
    const result = calculateComplianceRate(purchases, [activeContract], today)
    expect(result.compliancePercent).toBe(100)
    expect(result.totalPurchases).toBe(2)
    expect(result.compliantPurchases).toBe(2)
  })

  it("calculates partial compliance with violation breakdown", () => {
    const purchases: CompliancePurchase[] = [
      { vendorId: "v1", vendorItemNo: "SKU-A", unitPrice: 100, purchaseDate: today }, // good
      { vendorId: "v1", vendorItemNo: "SKU-X", unitPrice: 20, purchaseDate: today }, // unapproved
      { vendorId: "v9", vendorItemNo: "SKU-X", unitPrice: 20, purchaseDate: today }, // off contract
      { vendorId: "v1", vendorItemNo: "SKU-A", unitPrice: 115, purchaseDate: today }, // price variance
    ]
    const result = calculateComplianceRate(purchases, [activeContract], today)
    expect(result.compliancePercent).toBe(25) // 1 of 4
    expect(result.violationCounts.off_contract).toBe(1)
    expect(result.violationCounts.unapproved_item).toBe(1)
    expect(result.violationCounts.price_variance).toBe(1)
  })

  it("returns 0% with zero purchases flagged as N/A (no denominator)", () => {
    const result = calculateComplianceRate([], [activeContract], today)
    expect(result.totalPurchases).toBe(0)
    expect(result.compliancePercent).toBeNull()
  })
})

describe("calculateMarketShare", () => {
  it("computes currentMarketShare correctly", () => {
    const result = calculateMarketShare(30_000, 100_000, 25)
    expect(result.currentMarketShare).toBe(30)
    expect(result.commitmentMet).toBe(true)
    expect(result.gap).toBe(5) // exceeding by 5pp
  })

  it("flags under-commitment with negative gap", () => {
    const result = calculateMarketShare(20_000, 100_000, 30)
    expect(result.currentMarketShare).toBe(20)
    expect(result.commitmentMet).toBe(false)
    expect(result.gap).toBe(-10)
  })

  it("handles zero category total gracefully", () => {
    const result = calculateMarketShare(0, 0, 25)
    expect(result.currentMarketShare).toBe(0)
    expect(result.commitmentMet).toBe(false)
  })

  it("treats undefined commitment as N/A", () => {
    const result = calculateMarketShare(30_000, 100_000, null)
    expect(result.currentMarketShare).toBe(30)
    expect(result.commitmentMet).toBeNull()
    expect(result.gap).toBeNull()
  })
})
