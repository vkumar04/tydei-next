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
const termFindFirst = vi.fn()
const termCreate = vi.fn()
const pricingFindMany = vi.fn()
const pricingCount = vi.fn()
const contractFindUnique = vi.fn()
const termProductDeleteMany = vi.fn()
const termProductCreateMany = vi.fn()
const termUpdate = vi.fn()
const transaction = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUnique: contractFindUnique,
    },
    contractTerm: {
      findMany: termFindMany,
      findFirst: termFindFirst,
      create: termCreate,
      update: termUpdate,
    },
    contractPricing: {
      findMany: pricingFindMany,
      count: pricingCount,
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

describe("ensureCarveOutTermFromPricing", () => {
  it("auto-creates exactly one carve_out term when pricing has carveOutPercent>0 and none exists", async () => {
    // Pricing file carries carve-out flags (the SYK signal)…
    pricingCount.mockResolvedValueOnce(50)
    // …and the contract has no carve_out term yet.
    termFindFirst.mockResolvedValueOnce(null)
    contractFindUnique.mockResolvedValueOnce({
      effectiveDate: new Date(Date.UTC(2025, 0, 1)),
      expirationDate: new Date(Date.UTC(2026, 11, 31)),
    })
    termCreate.mockResolvedValueOnce({ id: "new-term" })

    const { ensureCarveOutTermFromPricing } = await import(
      "../populate-carveout-terms"
    )
    const r = await ensureCarveOutTermFromPricing("c1")

    expect(r).toEqual({
      created: true,
      termId: "new-term",
      carveOutSkuCount: 50,
    })
    expect(termCreate).toHaveBeenCalledTimes(1)
    const arg = termCreate.mock.calls[0][0]
    expect(arg.data).toMatchObject({
      contractId: "c1",
      termType: "carve_out",
      appliesTo: "specific_items",
      termName: "Carve-Out (from pricing file)",
    })
    // Scoped to the contract's window.
    expect(arg.data.effectiveStart).toEqual(new Date(Date.UTC(2025, 0, 1)))
    expect(arg.data.effectiveEnd).toEqual(new Date(Date.UTC(2026, 11, 31)))
  })

  it("creates NO term for a pure spend-rebate file (no carveOutPercent rows)", async () => {
    pricingCount.mockResolvedValueOnce(0)

    const { ensureCarveOutTermFromPricing } = await import(
      "../populate-carveout-terms"
    )
    const r = await ensureCarveOutTermFromPricing("c1")

    expect(r).toEqual({ created: false, termId: null, carveOutSkuCount: 0 })
    expect(termFindFirst).not.toHaveBeenCalled()
    expect(termCreate).not.toHaveBeenCalled()
  })

  it("is idempotent: does not create a second term when one already exists", async () => {
    pricingCount.mockResolvedValueOnce(50)
    termFindFirst.mockResolvedValueOnce({ id: "existing-term" })

    const { ensureCarveOutTermFromPricing } = await import(
      "../populate-carveout-terms"
    )
    const r = await ensureCarveOutTermFromPricing("c1")

    expect(r).toEqual({
      created: false,
      termId: "existing-term",
      carveOutSkuCount: 50,
    })
    expect(termCreate).not.toHaveBeenCalled()
  })

  it("falls back to evergreen sentinels when the contract has no dates", async () => {
    pricingCount.mockResolvedValueOnce(1)
    termFindFirst.mockResolvedValueOnce(null)
    contractFindUnique.mockResolvedValueOnce(null)
    termCreate.mockResolvedValueOnce({ id: "new-term" })

    const { ensureCarveOutTermFromPricing } = await import(
      "../populate-carveout-terms"
    )
    await ensureCarveOutTermFromPricing("c1")

    const arg = termCreate.mock.calls[0][0]
    expect(arg.data.effectiveStart).toEqual(new Date(Date.UTC(1970, 0, 1)))
    expect(arg.data.effectiveEnd).toEqual(new Date(Date.UTC(9999, 11, 31)))
  })
})
