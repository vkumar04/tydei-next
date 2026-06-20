import { describe, it, expect } from "vitest"
import {
  buildSurgeonVendorSpend,
  UNKNOWN_SURGEON,
  UNKNOWN_VENDOR,
  type SVCase,
  type SVSupply,
} from "../surgeon-vendor-spend"

// Vendor resolver: on-contract → contract's vendor; else SKU map; else Unknown.
const vendorByContract: Record<string, string> = { "c-stryker": "Stryker", "c-arthrex": "Arthrex" }
const vendorBySku: Record<string, string> = { "SKU1": "DePuy" }
const resolve = (s: SVSupply): string => {
  if (s.contractId && vendorByContract[s.contractId]) return vendorByContract[s.contractId]
  if (s.vendorItemNo && vendorBySku[s.vendorItemNo]) return vendorBySku[s.vendorItemNo]
  return UNKNOWN_VENDOR
}

const cases: SVCase[] = [
  {
    surgeonName: "Dr. Smith",
    supplies: [
      { isOnContract: true, contractId: "c-stryker", vendorItemNo: "A", extendedCost: 1000 },
      { isOnContract: true, contractId: "c-stryker", vendorItemNo: "B", extendedCost: 500 },
      { isOnContract: false, contractId: null, vendorItemNo: "SKU1", extendedCost: 300 }, // DePuy off-contract
    ],
  },
  {
    surgeonName: "Dr. Smith",
    supplies: [
      { isOnContract: false, contractId: null, vendorItemNo: "ZZZ", extendedCost: 200 }, // unknown
      { isOnContract: false, contractId: null, vendorItemNo: "X", extendedCost: 0 }, // $0 ignored
    ],
  },
  {
    surgeonName: null, // unknown surgeon
    supplies: [{ isOnContract: true, contractId: "c-arthrex", vendorItemNo: "Q", extendedCost: 800 }],
  },
]

describe("buildSurgeonVendorSpend", () => {
  const rows = buildSurgeonVendorSpend(cases, resolve)

  it("groups by (surgeon, vendor) and splits on/off-contract spend", () => {
    const smithStryker = rows.find((r) => r.surgeonName === "Dr. Smith" && r.vendorName === "Stryker")
    expect(smithStryker).toBeTruthy()
    expect(smithStryker!.totalSpend).toBe(1500)
    expect(smithStryker!.onContractSpend).toBe(1500)
    expect(smithStryker!.offContractSpend).toBe(0)
    expect(smithStryker!.compliancePercent).toBe(100)
    expect(smithStryker!.supplyCount).toBe(2)
  })

  it("resolves off-contract vendor via the SKU map and marks it non-compliant", () => {
    const smithDePuy = rows.find((r) => r.surgeonName === "Dr. Smith" && r.vendorName === "DePuy")
    expect(smithDePuy!.totalSpend).toBe(300)
    expect(smithDePuy!.onContractSpend).toBe(0)
    expect(smithDePuy!.compliancePercent).toBe(0)
  })

  it("buckets unresolved vendors as Unknown vendor", () => {
    const unknown = rows.find((r) => r.surgeonName === "Dr. Smith" && r.vendorName === UNKNOWN_VENDOR)
    expect(unknown!.totalSpend).toBe(200)
  })

  it("ignores $0 supplies", () => {
    // 2 stryker + 1 depuy + 1 unknown + 1 arthrex = 5 counted; the single
    // $0 supply is dropped (would otherwise be 6).
    const total = rows.reduce((s, r) => s + r.supplyCount, 0)
    expect(total).toBe(5)
  })

  it("falls back to Unknown surgeon for null surgeon names", () => {
    const u = rows.find((r) => r.surgeonName === UNKNOWN_SURGEON)
    expect(u!.vendorName).toBe("Arthrex")
    expect(u!.totalSpend).toBe(800)
  })

  it("sorts by surgeon A→Z then spend desc", () => {
    // Dr. Smith rows come before Unknown surgeon; within Smith, Stryker (1500) first.
    expect(rows[0]!.surgeonName).toBe("Dr. Smith")
    expect(rows[0]!.vendorName).toBe("Stryker")
    expect(rows[rows.length - 1]!.surgeonName).toBe(UNKNOWN_SURGEON)
  })

  // BUG 11 (Charles 2026-06-20 "the Stryker spend does not come up here"):
  // the prod symptom — every row Unknown vendor / $0 on-contract / 0%
  // compliance — is DIAGNOSTIC of missing attribution data (CaseSupply rows
  // with contractId=null AND a SKU absent from COG), NOT a builder bug. This
  // test pins that signature so a future "fix" can't mask the data gap in code.
  it("missing contractId + unmatched SKU → Unknown vendor / 0% compliance (data-gap signature)", () => {
    const orphan = buildSurgeonVendorSpend(
      [
        {
          surgeonName: "Dr. Jones",
          supplies: [
            { isOnContract: false, contractId: null, vendorItemNo: "NOPE-1", extendedCost: 30_118 },
          ],
        },
      ],
      resolve,
    )
    expect(orphan).toHaveLength(1)
    expect(orphan[0]!.vendorName).toBe(UNKNOWN_VENDOR)
    expect(orphan[0]!.totalSpend).toBe(30_118)
    expect(orphan[0]!.onContractSpend).toBe(0)
    expect(orphan[0]!.compliancePercent).toBe(0)
  })
})
