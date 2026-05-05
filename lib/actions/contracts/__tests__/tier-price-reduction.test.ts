/**
 * Integration tests for `getTierPriceReductionForContract`.
 *
 * Mocks Prisma + auth at the module boundary; builds in-memory contract /
 * term / tier / COG fixtures that exercise the bridge → engine path.
 *
 * Engine math correctness is covered by per-engine unit tests; these
 * assertions just lock down that the wrapper assembles the right
 * RebateConfig and PeriodData from Prisma data.
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
  terms: FakeTerm[]
} | null

let contractFixture: FakeContract = null
let cogFixture: Array<{
  inventoryNumber: string
  category: string | null
  quantity: number
  unitCost: number
  extendedPrice: number
  transactionDate: Date
}> = []
let requireFacilityImpl: () => Promise<unknown> = async () => ({
  facility: { id: "fac-1" },
  user: { id: "user-1" },
})

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
  requireFacility: vi.fn(() => requireFacilityImpl()),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

import { getTierPriceReductionForContract } from "@/lib/actions/contracts/tier-price-reduction"

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
    termType: "price_reduction",
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
    marketShareCategory: null,
    periodCap: null,
    groupedReferenceNumbers: null,
    priceReductionTrigger: "retroactive",
    createdAt: new Date("2026-01-01"),
    tiers: [],
    ...overrides,
  }
}

describe("getTierPriceReductionForContract", () => {
  beforeEach(() => {
    contractFixture = null
    cogFixture = []
    requireFacilityImpl = async () => ({
      facility: { id: "fac-1" },
      user: { id: "user-1" },
    })
  })

  it("happy path: 3 tiers, period spend in middle tier → priceReductionLines populated", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeTerm({
          tiers: [
            makeTier({
              tierNumber: 1,
              spendMin: 0,
              spendMax: 10_000,
              priceReductionPercent: 0.05,
            }),
            makeTier({
              tierNumber: 2,
              spendMin: 10_000,
              spendMax: 50_000,
              priceReductionPercent: 0.1, // 10% off — middle tier
            }),
            makeTier({
              tierNumber: 3,
              spendMin: 50_000,
              spendMax: null,
              priceReductionPercent: 0.15,
            }),
          ],
        }),
      ],
    }
    // ~$25k of spend → middle tier
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: "Cardiology",
        quantity: 100,
        unitCost: 250,
        extendedPrice: 25_000,
        transactionDate: new Date("2026-03-01"),
      },
    ]

    const r = await getTierPriceReductionForContract({ contractId: "c-1" })
    expect(r.result).not.toBeNull()
    expect(r.result?.type).toBe("TIER_PRICE_REDUCTION")
    // Engine computed a real reduction value & line.
    expect(r.result?.priceReductionValue).toBeGreaterThan(0)
    expect(r.result?.priceReductionLines?.length ?? 0).toBeGreaterThan(0)
    const line = r.result?.priceReductionLines?.[0]
    expect(line?.effectiveUnitPrice).toBeLessThan(line?.originalUnitPrice ?? 0)
    expect(r.diagnostics.skipReason).toBeUndefined()
    expect(r.termId).toBe("term-1")
  })

  it("no price_reduction term → returns null with skipReason", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [], // wrapper Prisma include filters by termType — empty here
    }
    const r = await getTierPriceReductionForContract({ contractId: "c-1" })
    expect(r.result).toBeNull()
    expect(r.diagnostics.skipReason).toMatch(/no price_reduction term/i)
  })

  it("auth gate: requireFacility rejects → wrapper throws", async () => {
    requireFacilityImpl = async () => {
      throw new Error("Unauthorized")
    }
    await expect(
      getTierPriceReductionForContract({ contractId: "c-1" }),
    ).rejects.toThrow(/Unauthorized/)
  })
})
