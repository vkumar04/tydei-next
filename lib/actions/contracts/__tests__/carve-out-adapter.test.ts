/**
 * Smoke test for the carve-out adapter. Exercises the pure
 * carve-out engine through a mock Prisma layer so the adapter's
 * shape-mapping (ContractPricing / COGRecord → CarveOutConfig +
 * PurchaseRecord) is locked down.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

let pricingRows: Array<{
  vendorItemNo: string
  carveOutPercent: number | null
}> = []
let cogRows: Array<{
  vendorItemNo: string | null
  quantity: number
  unitCost: number
  extendedPrice: number | null
  transactionDate: Date
  category: string | null
}> = []
// Charles 2026-06-07: carve-out now only computes when the contract has a
// `carve_out` term. Default the mock contract to having one so the
// existing line-math assertions still exercise the compute path; the
// term-gate regression test below flips this to a spend-rebate term.
let contractTerms: Array<{
  termType: string
  termName?: string
  appliesTo?: string | null
  categories?: string[]
  tiers?: Array<{ rebateValue: number; rebateType: string }>
}> = [{ termType: "carve_out" }]

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirstOrThrow: vi.fn(async () => ({
        id: "c-1",
        vendorId: "v-1",
        terms: contractTerms,
      })),
    },
    contractPricing: {
      findMany: vi.fn(async () => pricingRows),
    },
    cOGRecord: {
      findMany: vi.fn(async () => cogRows),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

import { getCarveOutRebate } from "@/lib/actions/contracts/carve-out"

describe("getCarveOutRebate (W1.Z-A wire)", () => {
  beforeEach(() => {
    pricingRows = []
    cogRows = []
    contractTerms = [{ termType: "carve_out" }]
  })

  it("spend-rebate contract (no carve_out term) → empty result even with carveOutPercent pricing (Charles 2026-06-07)", async () => {
    // Regression: a pure spend-rebate contract whose pricing file carried
    // carveOutPercent values showed a phantom carve-out rebate. The
    // term-gate must return empty without scanning pricing/COG.
    contractTerms = [{ termType: "spend_rebate" }]
    pricingRows = [{ vendorItemNo: "SKU-A", carveOutPercent: 0.05 }]
    cogRows = [
      {
        vendorItemNo: "SKU-A",
        quantity: 10,
        unitCost: 100,
        extendedPrice: 10_000,
        transactionDate: new Date("2026-03-01"),
        category: null,
      },
    ]
    const r = await getCarveOutRebate("c-1")
    expect(r.rebateEarned).toBe(0)
    expect(r.carveOutLines ?? []).toHaveLength(0)
    expect(r.eligibleSpend).toBe(0)
  })

  it("empty contract → zero rebate, empty lines", async () => {
    const r = await getCarveOutRebate("c-1")
    expect(r.rebateEarned).toBe(0)
    expect(r.carveOutLines ?? []).toHaveLength(0)
  })

  it("spend-rebate carve_out term (percent-of-spend tier, NO per-SKU lines) → category-scoped rebate (Charles 2026-06-20 BUG 10)", async () => {
    // The carve-out is expressed as a 2% spend rebate scoped to "Spine", with
    // no carveOutPercent pricing rows. The per-SKU engine can't price it, so
    // the card used to show $0. Now it computes 2% of matched Spine spend.
    contractTerms = [
      {
        termType: "carve_out",
        termName: "Spine carve-out",
        appliesTo: "specific_category",
        categories: ["Spine"],
        tiers: [{ rebateValue: 0.02, rebateType: "percent_of_spend" }],
      },
    ]
    pricingRows = [] // no per-SKU carveOutPercent rows
    cogRows = [
      {
        vendorItemNo: "SKU-SPINE",
        quantity: 1,
        unitCost: 100_000,
        extendedPrice: 100_000,
        transactionDate: new Date("2026-03-01"),
        category: "Spine",
      },
      {
        // Out-of-scope category — must NOT contribute.
        vendorItemNo: "SKU-KNEE",
        quantity: 1,
        unitCost: 50_000,
        extendedPrice: 50_000,
        transactionDate: new Date("2026-03-01"),
        category: "Joint Replacement",
      },
    ]
    const r = await getCarveOutRebate("c-1")
    // 2% × $100k Spine spend = $2,000 (knee spend excluded).
    expect(r.rebateEarned).toBe(2_000)
    expect(r.carveOutLines).toHaveLength(1)
    expect(r.carveOutLines![0]!.totalSpend).toBe(100_000)
    // eligibleSpend must be the carved-out spend basis so the performance
    // card shows "eligible spend" and the effective-rate line (gated on
    // eligibleSpend > 0). Effective rate = 2000 / 100000 = 2.0%.
    expect(r.eligibleSpend).toBe(100_000)
    expect((r.rebateEarned / r.eligibleSpend) * 100).toBeCloseTo(2.0)
  })

  it("single carve-out line at 5% on $10k spend → $500", async () => {
    pricingRows = [
      { vendorItemNo: "SKU-A", carveOutPercent: 0.05 },
    ]
    cogRows = [
      {
        vendorItemNo: "SKU-A",
        quantity: 10,
        unitCost: 100,
        extendedPrice: 10_000,
        transactionDate: new Date("2026-03-01"),
        category: null,
      },
    ]
    const r = await getCarveOutRebate("c-1")
    expect(r.rebateEarned).toBe(500)
    expect(r.carveOutLines).toHaveLength(1)
    const line = r.carveOutLines![0]!
    expect(line.referenceNumber).toBe("SKU-A")
    expect(line.lineRebate).toBe(500)
  })

  it("multiple lines aggregate correctly", async () => {
    pricingRows = [
      { vendorItemNo: "SKU-A", carveOutPercent: 0.03 }, // 3%
      { vendorItemNo: "SKU-B", carveOutPercent: 0.05 }, // 5%
    ]
    cogRows = [
      {
        vendorItemNo: "SKU-A",
        quantity: 1,
        unitCost: 100_000,
        extendedPrice: 100_000,
        transactionDate: new Date("2026-03-01"),
        category: null,
      },
      {
        vendorItemNo: "SKU-B",
        quantity: 1,
        unitCost: 50_000,
        extendedPrice: 50_000,
        transactionDate: new Date("2026-04-01"),
        category: null,
      },
    ]
    const r = await getCarveOutRebate("c-1")
    // 100k × 3% + 50k × 5% = 3000 + 2500 = 5500
    expect(r.rebateEarned).toBe(5_500)
    expect(r.carveOutLines).toHaveLength(2)
  })

  it("COG rows whose SKU isn't carved-out don't contribute", async () => {
    pricingRows = [
      { vendorItemNo: "SKU-A", carveOutPercent: 0.03 },
    ]
    cogRows = [
      {
        vendorItemNo: "SKU-A",
        quantity: 1,
        unitCost: 100_000,
        extendedPrice: 100_000,
        transactionDate: new Date(),
        category: null,
      },
      {
        vendorItemNo: "SKU-OTHER",
        quantity: 1,
        unitCost: 50_000,
        extendedPrice: 50_000,
        transactionDate: new Date(),
        category: null,
      },
    ]
    const r = await getCarveOutRebate("c-1")
    expect(r.rebateEarned).toBe(3_000) // only SKU-A counts
  })

  it("filters out null vendorItemNo COG rows", async () => {
    pricingRows = [
      { vendorItemNo: "SKU-A", carveOutPercent: 0.03 },
    ]
    cogRows = [
      {
        vendorItemNo: null,
        quantity: 1,
        unitCost: 100_000,
        extendedPrice: 100_000,
        transactionDate: new Date(),
        category: null,
      },
    ]
    const r = await getCarveOutRebate("c-1")
    expect(r.rebateEarned).toBe(0)
  })
})
