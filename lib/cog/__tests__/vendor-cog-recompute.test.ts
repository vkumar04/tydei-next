/**
 * BUG 5b (Charles 2026-06-20): vendor-owned COG was never matched to the
 * vendor's contracts, so "On Contract" was structurally 0. These lock the pure
 * classifier that the recompute pipeline uses.
 */
import { describe, it, expect } from "vitest"
import { classifyVendorCogRow } from "@/lib/cog/vendor-cog-recompute"
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

describe("classifyVendorCogRow", () => {
  it("on-contract within the price threshold → on_contract with savings", () => {
    const { ctx, prices } = ctxWithPricedSku()
    // unitCost 99 vs contract 100 = −1% (within the ±2% threshold).
    const r = classifyVendorCogRow(
      { vendorItemNo: "ABC-100", vendorName: null, transactionDate: txn, unitCost: 99, quantity: 10 },
      VENDOR,
      ctx,
      prices,
    )
    expect(r.matchStatus).toBe("on_contract")
    expect(r.isOnContract).toBe(true)
    expect(r.contractId).toBe(CONTRACT)
    expect(r.contractPrice).toBe(100)
    expect(r.savingsAmount).toBe(10) // (100 - 99) * 10
  })

  it("unit cost above the contract price beyond threshold → price_variance", () => {
    const { ctx, prices } = ctxWithPricedSku()
    const r = classifyVendorCogRow(
      { vendorItemNo: "ABC-100", vendorName: null, transactionDate: txn, unitCost: 130, quantity: 1 },
      VENDOR,
      ctx,
      prices,
    )
    expect(r.matchStatus).toBe("price_variance")
    expect(r.isOnContract).toBe(true)
    expect(r.variancePercent).toBeCloseTo(30) // (130-100)/100
  })

  it("vendor+date match with no priced SKU → on_contract, no price", () => {
    const { ctx } = ctxWithPricedSku()
    const r = classifyVendorCogRow(
      // SKU not in the pricing map, but vendor+date covers it.
      { vendorItemNo: "ZZZ-999", vendorName: null, transactionDate: txn, unitCost: 50, quantity: 1 },
      VENDOR,
      ctx,
      new Map(),
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
      { vendorItemNo: "ABC-100", vendorName: null, transactionDate: txn, unitCost: 90, quantity: 1 },
      VENDOR,
      ctx,
      new Map(),
    )
    expect(r.matchStatus).toBe("off_contract_item")
    expect(r.isOnContract).toBe(false)
    expect(r.contractId).toBeNull()
  })

  it("transaction outside the contract window → off_contract_item", () => {
    const { ctx, prices } = ctxWithPricedSku()
    const r = classifyVendorCogRow(
      { vendorItemNo: "ABC-100", vendorName: null, transactionDate: new Date("2030-01-01"), unitCost: 90, quantity: 1 },
      VENDOR,
      ctx,
      prices,
    )
    expect(r.matchStatus).toBe("off_contract_item")
    expect(r.isOnContract).toBe(false)
  })
})
