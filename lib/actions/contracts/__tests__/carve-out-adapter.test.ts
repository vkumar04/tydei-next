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

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirstOrThrow: vi.fn(async () => ({
        id: "c-1",
        vendorId: "v-1",
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
  })

  it("empty contract → zero rebate, empty lines", async () => {
    const r = await getCarveOutRebate("c-1")
    expect(r.rebateEarned).toBe(0)
    expect(r.carveOutLines ?? []).toHaveLength(0)
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
