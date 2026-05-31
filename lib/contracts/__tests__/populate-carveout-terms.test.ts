/**
 * Tests for the carve-out term auto-populate helper.
 *
 * Vick 2026-05-31: "It should use the pricing file to pick all of the
 * items for you for carve out." After every pricing import the carve_out
 * terms on a contract should have their ContractTermProduct rows
 * rebuilt from pricing rows whose carveOutPercent > 0, and the term's
 * appliesTo should flip to "specific_items".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const termFindMany = vi.fn()
const pricingFindMany = vi.fn()
const termProductDeleteMany = vi.fn()
const termProductCreateMany = vi.fn()
const termUpdate = vi.fn()
const transaction = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    contractTerm: {
      findMany: termFindMany,
      update: termUpdate,
    },
    contractPricing: {
      findMany: pricingFindMany,
    },
    contractTermProduct: {
      deleteMany: termProductDeleteMany,
      createMany: termProductCreateMany,
    },
    $transaction: transaction,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Default transaction implementation: pass a tx that proxies the
  // top-level mock functions so assertions can see writes.
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      contractTermProduct: {
        deleteMany: termProductDeleteMany,
        createMany: termProductCreateMany,
      },
      contractTerm: { update: termUpdate },
    }
    return fn(tx)
  })
})

describe("populateCarveOutTermsForContract", () => {
  it("returns zeros when the contract has no carve_out terms", async () => {
    termFindMany.mockResolvedValueOnce([])
    const { populateCarveOutTermsForContract } = await import(
      "../populate-carveout-terms"
    )
    const r = await populateCarveOutTermsForContract("c1")
    expect(r).toEqual({ termsFound: 0, productsLinked: 0, carveOutSkuCount: 0 })
    expect(pricingFindMany).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it("returns termsFound but skips writes when no carve-out SKUs exist", async () => {
    termFindMany.mockResolvedValueOnce([{ id: "t1" }])
    pricingFindMany.mockResolvedValueOnce([])
    const { populateCarveOutTermsForContract } = await import(
      "../populate-carveout-terms"
    )
    const r = await populateCarveOutTermsForContract("c1")
    expect(r).toEqual({ termsFound: 1, productsLinked: 0, carveOutSkuCount: 0 })
    expect(transaction).not.toHaveBeenCalled()
    expect(termUpdate).not.toHaveBeenCalled()
  })

  it("rebuilds ContractTermProduct rows for each carve_out term", async () => {
    termFindMany.mockResolvedValueOnce([{ id: "t1" }, { id: "t2" }])
    pricingFindMany.mockResolvedValueOnce([
      { vendorItemNo: "SKU-1", description: "Plate", unitPrice: 100 },
      { vendorItemNo: "SKU-2", description: "Screw", unitPrice: 50 },
    ])
    termProductCreateMany.mockResolvedValue({ count: 2 })

    const { populateCarveOutTermsForContract } = await import(
      "../populate-carveout-terms"
    )
    const r = await populateCarveOutTermsForContract("c1")

    expect(r).toEqual({
      termsFound: 2,
      productsLinked: 4, // 2 SKUs × 2 terms
      carveOutSkuCount: 2,
    })
    // deleteMany called once per term — clears any stale per-term scope
    expect(termProductDeleteMany).toHaveBeenCalledTimes(2)
    expect(termProductDeleteMany).toHaveBeenCalledWith({
      where: { termId: "t1" },
    })
    expect(termProductDeleteMany).toHaveBeenCalledWith({
      where: { termId: "t2" },
    })
    // createMany shape — vendorItemNo + description + price preserved
    expect(termProductCreateMany).toHaveBeenCalledWith({
      data: [
        {
          termId: "t1",
          vendorItemNo: "SKU-1",
          productDescription: "Plate",
          contractPrice: 100,
        },
        {
          termId: "t1",
          vendorItemNo: "SKU-2",
          productDescription: "Screw",
          contractPrice: 50,
        },
      ],
    })
    // appliesTo flipped to specific_items on EVERY carve-out term
    // (Vick 2026-05-31 #3 — was the orphan "specific_products"; now the
    // value the term-editor dropdown + SpecificItemsPicker recognize).
    expect(termUpdate).toHaveBeenCalledTimes(2)
    expect(termUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { appliesTo: "specific_items" },
    })
    expect(termUpdate).toHaveBeenCalledWith({
      where: { id: "t2" },
      data: { appliesTo: "specific_items" },
    })
  })

  it("only queries pricing rows where carveOutPercent > 0", async () => {
    termFindMany.mockResolvedValueOnce([{ id: "t1" }])
    pricingFindMany.mockResolvedValueOnce([])
    const { populateCarveOutTermsForContract } = await import(
      "../populate-carveout-terms"
    )
    await populateCarveOutTermsForContract("c1")
    // Filter must match the helper docstring — only items the pricing
    // file flagged as carve-out feed the term scope.
    expect(pricingFindMany).toHaveBeenCalledWith({
      where: {
        contractId: "c1",
        carveOutPercent: { not: null, gt: 0 },
      },
      select: { vendorItemNo: true, description: true, unitPrice: true },
    })
  })

  it("batches large SKU lists at 1000 per createMany call", async () => {
    termFindMany.mockResolvedValueOnce([{ id: "t1" }])
    const big = Array.from({ length: 2500 }, (_, i) => ({
      vendorItemNo: `SKU-${i}`,
      description: null,
      unitPrice: 1,
    }))
    pricingFindMany.mockResolvedValueOnce(big)
    termProductCreateMany.mockResolvedValueOnce({ count: 1000 })
    termProductCreateMany.mockResolvedValueOnce({ count: 1000 })
    termProductCreateMany.mockResolvedValueOnce({ count: 500 })

    const { populateCarveOutTermsForContract } = await import(
      "../populate-carveout-terms"
    )
    const r = await populateCarveOutTermsForContract("c1")
    // 2500 SKUs → 3 batches (1000 + 1000 + 500)
    expect(termProductCreateMany).toHaveBeenCalledTimes(3)
    expect(r.productsLinked).toBe(2500)
  })
})
