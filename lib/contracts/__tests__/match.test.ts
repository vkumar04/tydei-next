import { describe, it, expect } from "vitest"
import {
  matchCOGRecordToContract,
  PRICE_VARIANCE_THRESHOLD,
  type CogRecordForMatch,
  type ContractForMatch,
  type ContractPricingItemForMatch,
} from "../match"

const baseRecord: CogRecordForMatch = {
  facilityId: "fac-1",
  vendorId: "vendor-1",
  vendorName: "Acme Medical",
  vendorItemNo: "ITEM-100",
  unitCost: 100,
  quantity: 10,
  transactionDate: new Date("2026-03-15"),
}

const onContractItem = (
  overrides: Partial<ContractPricingItemForMatch> = {},
): ContractPricingItemForMatch => ({
  vendorItemNo: "ITEM-100",
  unitPrice: 100,
  listPrice: 120,
  ...overrides,
})

const baseContract = (
  overrides: Partial<ContractForMatch> = {},
): ContractForMatch => ({
  id: "c-1",
  vendorId: "vendor-1",
  status: "active",
  effectiveDate: new Date("2026-01-01"),
  expirationDate: new Date("2026-12-31"),
  facilityIds: ["fac-1"],
  pricingItems: [onContractItem()],
  ...overrides,
})

describe("matchCOGRecordToContract", () => {
  it("returns unknown_vendor when record has no vendorId", () => {
    const r = { ...baseRecord, vendorId: null }
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("unknown_vendor")
  })

  it("returns off_contract_item when vendor has no active contracts", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ status: "expired" }),
    ])
    expect(result.status).toBe("off_contract_item")
  })

  it("returns out_of_scope when contract does not cover facility", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ facilityIds: ["fac-other"] }),
    ])
    expect(result.status).toBe("out_of_scope")
  })

  it("returns out_of_scope when transactionDate is outside contract window", () => {
    const r = { ...baseRecord, transactionDate: new Date("2027-01-15") }
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("out_of_scope")
  })

  it("returns off_contract_item when vendor+facility+date match but item is not on contract", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({
        pricingItems: [onContractItem({ vendorItemNo: "OTHER-ITEM" })],
      }),
    ])
    expect(result.status).toBe("off_contract_item")
  })

  it("returns on_contract when item matches at contract price (within 2%)", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({
        pricingItems: [onContractItem({ unitPrice: 100, listPrice: 120 })],
      }),
    ])
    expect(result.status).toBe("on_contract")
    if (result.status === "on_contract") {
      expect(result.contractId).toBe("c-1")
      expect(result.contractPrice).toBe(100)
      // (listPrice - unitPrice) × quantity = (120 - 100) × 10 = 200
      expect(result.savings).toBe(200)
    }
  })

  it("returns price_variance when actual is >2% above contract price", () => {
    const r = { ...baseRecord, unitCost: 110 } // 10% overpay
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("price_variance")
    if (result.status === "price_variance") {
      expect(result.contractId).toBe("c-1")
      expect(result.contractPrice).toBe(100)
      // (110 - 100) / 100 × 100 = 10%
      expect(result.variancePercent).toBeCloseTo(10, 2)
    }
  })

  it("returns on_contract when actual is within 2% of contract (edge)", () => {
    const r = { ...baseRecord, unitCost: 101.5 } // 1.5% — within threshold
    const result = matchCOGRecordToContract(r, [baseContract()])
    expect(result.status).toBe("on_contract")
  })

  it("vendorItemNo match is case-insensitive", () => {
    const r = { ...baseRecord, vendorItemNo: "item-100" }
    const result = matchCOGRecordToContract(r, [
      baseContract({
        pricingItems: [onContractItem({ vendorItemNo: "ITEM-100" })],
      }),
    ])
    expect(result.status).toBe("on_contract")
  })

  it("accepts 'expiring' status as active for match purposes", () => {
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({ status: "expiring" }),
    ])
    expect(result.status).toBe("on_contract")
  })

  it("exports PRICE_VARIANCE_THRESHOLD as 2", () => {
    expect(PRICE_VARIANCE_THRESHOLD).toBe(2)
  })
})
