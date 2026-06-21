/**
 * BUG 5b (Charles 2026-06-20): vendor-owned COG was never matched to the
 * vendor's contracts, so "On Contract" was structurally 0. These lock the pure
 * classifier — including that it sources the SKU from inventoryNumber (real
 * vendor exports leave vendorItemNo null) and honours the catalogPresent guard
 * (a vendor+date-only match is off-contract when the contract has a catalog).
 */
import { describe, it, expect } from "vitest"
import {
  classifyVendorCogRow,
  vendorCogSkuSource,
} from "@/lib/cog/vendor-cog-recompute"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import type { ResolveContext } from "@/lib/cog/match"

const VENDOR = "v-1"
const CONTRACT = "c-1"
const start = new Date("2024-01-01")
const end = new Date("2027-01-01")
const txn = new Date("2025-06-01")

// A contract with one priced SKU "ABC-100" @ $100, active over the window.
function ctxWithPricedSku(): {
  ctx: ResolveContext
  prices: Map<string, number>
} {
  const sku = normalizeSku("ABC-100")!
  const ctx: ResolveContext = {
    pricingByVendorItem: new Map([
      [sku, [{ contractId: CONTRACT, effectiveStart: start, effectiveEnd: end }]],
    ]),
    activeContractsByVendor: new Map([
      [VENDOR, [{ id: CONTRACT, effectiveDate: start, expirationDate: end }]],
    ]),
    fuzzyVendorMatch: () => null,
  }
  const prices = new Map([[`${CONTRACT}::${sku}`, 100]])
  return { ctx, prices }
}

// Helper to build a row with sensible nulls for the alternate SKU fields.
function row(over: Partial<Parameters<typeof classifyVendorCogRow>[0]>) {
  return {
    vendorItemNo: null,
    manufacturerNo: null,
    inventoryNumber: null,
    vendorName: null,
    transactionDate: txn,
    unitCost: 100,
    quantity: 1,
    ...over,
  }
}

describe("vendorCogSkuSource", () => {
  it("prefers vendorItemNo, then manufacturerNo, then inventoryNumber", () => {
    expect(vendorCogSkuSource({ vendorItemNo: "A", manufacturerNo: "B", inventoryNumber: "C" })).toBe("A")
    expect(vendorCogSkuSource({ vendorItemNo: null, manufacturerNo: "B", inventoryNumber: "C" })).toBe("B")
    expect(vendorCogSkuSource({ vendorItemNo: null, manufacturerNo: null, inventoryNumber: "C" })).toBe("C")
    expect(vendorCogSkuSource({ vendorItemNo: null, manufacturerNo: null, inventoryNumber: null })).toBeNull()
  })
})

describe("classifyVendorCogRow", () => {
  it("on-contract within the price threshold → on_contract with savings", () => {
    const { ctx, prices } = ctxWithPricedSku()
    const r = classifyVendorCogRow(
      row({ vendorItemNo: "ABC-100", unitCost: 99, quantity: 10 }),
      VENDOR,
      ctx,
      prices,
      true,
    )
    expect(r.matchStatus).toBe("on_contract")
    expect(r.isOnContract).toBe(true)
    expect(r.contractId).toBe(CONTRACT)
    expect(r.contractPrice).toBe(100)
    expect(r.savingsAmount).toBe(10) // (100 - 99) * 10
  })

  it("matches when the SKU is only in inventoryNumber (vendorItemNo null) — the real export shape", () => {
    const { ctx, prices } = ctxWithPricedSku()
    const r = classifyVendorCogRow(
      row({ inventoryNumber: "ABC-100", unitCost: 100, quantity: 1 }),
      VENDOR,
      ctx,
      prices,
      true,
    )
    expect(r.matchStatus).toBe("on_contract")
    expect(r.isOnContract).toBe(true)
    expect(r.contractPrice).toBe(100)
  })

  it("unit cost above the contract price beyond threshold → price_variance", () => {
    const { ctx, prices } = ctxWithPricedSku()
    const r = classifyVendorCogRow(
      row({ vendorItemNo: "ABC-100", unitCost: 130, quantity: 1 }),
      VENDOR,
      ctx,
      prices,
      true,
    )
    expect(r.matchStatus).toBe("price_variance")
    expect(r.variancePercent).toBeCloseTo(30)
  })

  it("vendor+date-only match is OFF-contract when a catalog exists (the prod over-count guard)", () => {
    const { ctx, prices } = ctxWithPricedSku()
    // SKU "ZZZ-999" isn't on the catalog, but vendor+date covers it. Because a
    // catalog IS present, this is genuinely off-contract.
    const r = classifyVendorCogRow(
      row({ inventoryNumber: "ZZZ-999", unitCost: 50 }),
      VENDOR,
      ctx,
      prices,
      true,
    )
    expect(r.matchStatus).toBe("off_contract_item")
    expect(r.isOnContract).toBe(false)
  })

  it("vendor+date-only match IS on-contract when NO contract has a catalog", () => {
    // Catalogless contract: only the vendor+date signal exists.
    const ctx: ResolveContext = {
      pricingByVendorItem: new Map(),
      activeContractsByVendor: new Map([
        [VENDOR, [{ id: CONTRACT, effectiveDate: start, expirationDate: end }]],
      ]),
      fuzzyVendorMatch: () => null,
    }
    const r = classifyVendorCogRow(
      row({ inventoryNumber: "ZZZ-999", unitCost: 50 }),
      VENDOR,
      ctx,
      new Map(),
      false, // catalogPresent = false
    )
    expect(r.matchStatus).toBe("on_contract")
    expect(r.isOnContract).toBe(true)
    expect(r.contractPrice).toBeNull()
  })

  it("no matching contract → off_contract_item", () => {
    const ctx: ResolveContext = {
      pricingByVendorItem: new Map(),
      activeContractsByVendor: new Map(),
      fuzzyVendorMatch: () => null,
    }
    const r = classifyVendorCogRow(
      row({ inventoryNumber: "ABC-100" }),
      VENDOR,
      ctx,
      new Map(),
      false,
    )
    expect(r.matchStatus).toBe("off_contract_item")
    expect(r.contractId).toBeNull()
  })

  it("transaction outside the contract window → off_contract_item", () => {
    const { ctx, prices } = ctxWithPricedSku()
    const r = classifyVendorCogRow(
      row({ inventoryNumber: "ABC-100", transactionDate: new Date("2030-01-01") }),
      VENDOR,
      ctx,
      prices,
      true,
    )
    expect(r.matchStatus).toBe("off_contract_item")
  })
})
