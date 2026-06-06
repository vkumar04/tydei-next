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

  // #2 (Vick 2026-05-31): grouped contracts must match COG from ANY
  // participating vendor against the contract's price-file ref numbers.
  it("matches a COG row from an ADDITIONAL group vendor by ref number", () => {
    const record = { ...baseRecord, vendorId: "vendor-2" } // a group member, not primary
    const grouped = baseContract({
      vendorId: "vendor-1", // primary
      additionalVendorIds: ["vendor-2", "vendor-3"],
    })
    const result = matchCOGRecordToContract(record, [grouped])
    expect(result.status).toBe("on_contract")
    if (result.status === "on_contract") {
      expect(result.contractId).toBe("c-1")
    }
  })

  it("does NOT match a vendor that is not in the group", () => {
    const record = { ...baseRecord, vendorId: "vendor-99" } // not primary, not additional
    const grouped = baseContract({
      vendorId: "vendor-1",
      additionalVendorIds: ["vendor-2"],
    })
    const result = matchCOGRecordToContract(record, [grouped])
    expect(result.status).toBe("off_contract_item")
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

  it("surfaces matchedCategory from the pricing item (Charles N15)", () => {
    // Charles iMessage 2026-04-20 N15: "category from that pricing
    // file needs to map to the COG data." The matcher returns the
    // pricing-row's category on the result so recompute-cog can copy
    // it onto COG rows that came in without their own category.
    const result = matchCOGRecordToContract(baseRecord, [
      baseContract({
        pricingItems: [
          onContractItem({ unitPrice: 100, category: "Ortho-Trauma" }),
        ],
      }),
    ])
    if (result.status !== "on_contract") throw new Error("expected on_contract")
    expect(result.matchedCategory).toBe("Ortho-Trauma")
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

  // ─── Charles W1.W-C4: category-scope filter ──────────────────────
  describe("category scope (W1.W-C4)", () => {
    it("returns out_of_scope when a specific_category term doesn't cover the COG row", () => {
      const r: CogRecordForMatch = { ...baseRecord, category: "Arthroscopy" }
      const result = matchCOGRecordToContract(r, [
        baseContract({
          terms: [
            {
              appliesTo: "specific_category",
              categories: ["Spine", "Joint Replacement"],
            },
          ],
        }),
      ])
      expect(result.status).toBe("out_of_scope")
    })

    it("matches on_contract when the COG row's category is in the term's list", () => {
      const r: CogRecordForMatch = { ...baseRecord, category: "Spine" }
      const result = matchCOGRecordToContract(r, [
        baseContract({
          terms: [
            {
              appliesTo: "specific_category",
              categories: ["Spine", "Joint Replacement"],
            },
          ],
        }),
      ])
      expect(result.status).toBe("on_contract")
    })

    it("ignores category when ANY term is broadly scoped (all_products)", () => {
      const r: CogRecordForMatch = { ...baseRecord, category: "SomethingElse" }
      const result = matchCOGRecordToContract(r, [
        baseContract({
          terms: [
            { appliesTo: "specific_category", categories: ["Spine"] },
            { appliesTo: "all_products", categories: [] },
          ],
        }),
      ])
      expect(result.status).toBe("on_contract")
    })

    it("treats a contract with no terms as covering everything (pre-W1.W behavior)", () => {
      const r: CogRecordForMatch = { ...baseRecord, category: "WhateverCat" }
      const result = matchCOGRecordToContract(r, [baseContract({ terms: [] })])
      expect(result.status).toBe("on_contract")
    })

    it("treats a null COG category as out-of-scope against a category-locked contract", () => {
      const r: CogRecordForMatch = { ...baseRecord, category: null }
      const result = matchCOGRecordToContract(r, [
        baseContract({
          terms: [{ appliesTo: "specific_category", categories: ["Spine"] }],
        }),
      ])
      expect(result.status).toBe("out_of_scope")
    })
  })
})

describe("matchCOGRecordToContract — reference-number fallback", () => {
  const base = {
    id: "c1",
    vendorId: "v-primary",
    additionalVendorIds: ["v-secondary"],
    status: "active" as const,
    effectiveDate: new Date("2026-01-01"),
    expirationDate: null,
    facilityIds: ["f1"],
  }

  it("matches by reference number when SKU is absent (membership, no savings)", () => {
    const contract: ContractForMatch = {
      ...base,
      pricingItems: [{ vendorItemNo: "SKU-A", unitPrice: 100, listPrice: 120 }],
      referenceNumbers: ["mfr-123"],
    }
    const record: CogRecordForMatch = {
      facilityId: "f1",
      vendorId: "v-secondary",
      vendorName: "Smith & Nephew, Inc.",
      vendorItemNo: "DIFFERENT-SKU",
      manufacturerNo: "MFR-123",
      unitCost: 100,
      quantity: 2,
      transactionDate: new Date("2026-03-01"),
    }
    const result = matchCOGRecordToContract(record, [contract])
    expect(result.status).toBe("on_contract")
    if (result.status === "on_contract") {
      expect(result.contractId).toBe("c1")
      expect(result.savings).toBe(0)
    }
  })

  it("resolves when COG row has no vendorItemNo but a manufacturerNo in the reference set", () => {
    const contract: ContractForMatch = {
      ...base,
      pricingItems: [{ vendorItemNo: "SKU-A", unitPrice: 50, listPrice: null }],
      referenceNumbers: ["mfr-999"],
    }
    const record: CogRecordForMatch = {
      facilityId: "f1",
      vendorId: "v-primary",
      vendorName: "ACME",
      vendorItemNo: null,
      manufacturerNo: "MFR-999",
      unitCost: 50,
      quantity: 1,
      transactionDate: new Date("2026-02-01"),
    }
    const result = matchCOGRecordToContract(record, [contract])
    expect(result.status).toBe("on_contract")
  })

  it("SKU match takes precedence and carries price over a reference-number membership", () => {
    const contract: ContractForMatch = {
      ...base,
      pricingItems: [{ vendorItemNo: "SKU-A", unitPrice: 100, listPrice: 120 }],
      referenceNumbers: ["mfr-123"],
    }
    const record: CogRecordForMatch = {
      facilityId: "f1",
      vendorId: "v-primary",
      vendorName: "ACME",
      vendorItemNo: "SKU-A",
      manufacturerNo: "MFR-123",
      unitCost: 100,
      quantity: 3,
      transactionDate: new Date("2026-03-01"),
    }
    const result = matchCOGRecordToContract(record, [contract])
    expect(result.status).toBe("on_contract")
    if (result.status === "on_contract") {
      expect(result.savings).toBe((120 - 100) * 3)
    }
  })
})
