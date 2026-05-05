/**
 * Integration tests for `getMarketShareRebateForContract`.
 *
 * Mocks Prisma + auth at the module boundary; builds in-memory contract /
 * term / tier / COG fixtures that exercise the bridge → engine path.
 *
 * The wrapper computes vendor + total category spend from COG and feeds
 * them to the canonical market-share engine. Engine math correctness is
 * covered by per-engine unit tests; these assertions just lock down that
 * the wrapper assembles the right RebateConfig + PeriodData.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type FakeTier = {
  id: string
  tierNumber: number
  tierName: string | null
  spendMin: number
  spendMax: number | null
  rebateValue: number
  rebateType: string
  fixedRebateAmount: number | null
  reducedPrice: number | null
  priceReductionPercent: number | null
}

type FakeTerm = {
  id: string
  termType: string
  rebateMethod: string | null
  boundaryRule: string | null
  appliesTo: string | null
  categories: string[] | null
  referenceNumbers: string[] | null
  baselineType: string | null
  negotiatedBaseline: number | null
  growthOnly: boolean | null
  cptCodes: string[] | null
  fixedRebatePerOccurrence: number | null
  marketShareVendorId: string | null
  marketShareCategory: string | null
  periodCap: number | null
  groupedReferenceNumbers: string[] | null
  priceReductionTrigger: string | null
  createdAt: Date
  tiers: FakeTier[]
}

type FakeContract = {
  id: string
  vendorId: string
  effectiveDate: Date
  expirationDate: Date
  productCategory: { name: string } | null
  terms: FakeTerm[]
} | null

let contractFixture: FakeContract = null
let cogFixture: Array<{
  vendorId: string
  inventoryNumber: string
  category: string | null
  quantity: number
  unitCost: number
  extendedPrice: number
  transactionDate: Date
}> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUnique: vi.fn(async () => contractFixture),
    },
    cOGRecord: {
      findMany: vi.fn(async () => cogFixture),
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

import { getMarketShareRebateForContract } from "@/lib/actions/contracts/market-share-rebate"

function makeTier(overrides: Partial<FakeTier>): FakeTier {
  return {
    id: "tier-x",
    tierNumber: 1,
    tierName: null,
    spendMin: 0,
    spendMax: null,
    rebateValue: 0,
    rebateType: "percent_of_spend",
    fixedRebateAmount: null,
    reducedPrice: null,
    priceReductionPercent: null,
    ...overrides,
  }
}

function makeTerm(overrides: Partial<FakeTerm> & { tiers?: FakeTier[] }): FakeTerm {
  return {
    id: "term-1",
    termType: "market_share",
    rebateMethod: "cumulative",
    boundaryRule: "exclusive",
    appliesTo: null,
    categories: null,
    referenceNumbers: null,
    baselineType: null,
    negotiatedBaseline: null,
    growthOnly: false,
    cptCodes: null,
    fixedRebatePerOccurrence: null,
    marketShareVendorId: null,
    marketShareCategory: "Cardiology",
    periodCap: null,
    groupedReferenceNumbers: null,
    priceReductionTrigger: null,
    createdAt: new Date("2026-01-01"),
    tiers: [],
    ...overrides,
  }
}

describe("getMarketShareRebateForContract", () => {
  beforeEach(() => {
    contractFixture = null
    cogFixture = []
  })

  it("happy path: vendor share above threshold → tier-based rebate earned", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      productCategory: { name: "Cardiology" },
      terms: [
        makeTerm({
          tiers: [
            // Tiers in market-share % terms; rebateValue is fraction at
            // Prisma boundary (×100 by bridge to integer percent).
            makeTier({ tierNumber: 1, spendMin: 0, spendMax: 50, rebateValue: 0.02 }),
            makeTier({ tierNumber: 2, spendMin: 50, spendMax: null, rebateValue: 0.05 }),
          ],
        }),
      ],
    }
    // Vendor v-1 owns 80k of 100k total → 80% share → tier 2.
    cogFixture = [
      {
        vendorId: "v-1",
        inventoryNumber: "SKU-A",
        category: "Cardiology",
        quantity: 1,
        unitCost: 80_000,
        extendedPrice: 80_000,
        transactionDate: new Date("2026-03-01"),
      },
      {
        vendorId: "v-other",
        inventoryNumber: "SKU-B",
        category: "Cardiology",
        quantity: 1,
        unitCost: 20_000,
        extendedPrice: 20_000,
        transactionDate: new Date("2026-03-01"),
      },
    ]
    const r = await getMarketShareRebateForContract({ contractId: "c-1" })
    expect(r.result).not.toBeNull()
    expect(r.result?.type).toBe("MARKET_SHARE_REBATE")
    expect(r.result?.rebateEarned).toBeGreaterThan(0)
    expect(r.diagnostics.totalCategorySpend).toBe(100_000)
    expect(r.diagnostics.vendorCategorySpend).toBe(80_000)
    expect(r.diagnostics.category).toBe("Cardiology")
    // Tier 2 is the highest-tier qualified at 80% share.
    expect(r.result?.tierResult?.tier.tierNumber).toBe(2)
  })

  it("vendor share below all tier thresholds → rebateEarned = 0", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      productCategory: { name: "Cardiology" },
      terms: [
        makeTerm({
          tiers: [
            makeTier({ tierNumber: 1, spendMin: 60, spendMax: null, rebateValue: 0.05 }),
          ],
        }),
      ],
    }
    // Vendor v-1 owns 10k of 100k total → 10% share → no tier qualifies.
    cogFixture = [
      {
        vendorId: "v-1",
        inventoryNumber: "SKU-A",
        category: "Cardiology",
        quantity: 1,
        unitCost: 10_000,
        extendedPrice: 10_000,
        transactionDate: new Date("2026-03-01"),
      },
      {
        vendorId: "v-other",
        inventoryNumber: "SKU-B",
        category: "Cardiology",
        quantity: 1,
        unitCost: 90_000,
        extendedPrice: 90_000,
        transactionDate: new Date("2026-03-01"),
      },
    ]
    const r = await getMarketShareRebateForContract({ contractId: "c-1" })
    expect(r.result).not.toBeNull()
    expect(r.result?.rebateEarned).toBe(0)
    expect(r.result?.tierResult).toBeNull()
  })

  it("missing totalCategorySpend (no COG rows) → engine returns fatal error", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      productCategory: { name: "Cardiology" },
      terms: [
        makeTerm({
          tiers: [
            makeTier({ tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 0.05 }),
          ],
        }),
      ],
    }
    cogFixture = [] // no COG rows → no totalCategorySpend → engine errors
    const r = await getMarketShareRebateForContract({ contractId: "c-1" })
    expect(r.result).not.toBeNull()
    expect(r.result?.errors.length ?? 0).toBeGreaterThan(0)
    expect(r.result?.errors.join(" ")).toMatch(/totalCategorySpend/)
    expect(r.result?.rebateEarned).toBe(0)
  })
})
