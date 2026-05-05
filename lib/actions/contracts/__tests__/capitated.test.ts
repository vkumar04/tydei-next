/**
 * Integration tests for `getCapitatedRebateForContract`.
 *
 * Mocks Prisma + auth at the module boundary. The wrapper builds a
 * CAPITATED config (with optional embedded SPEND_REBATE) from the
 * contract's first `capitated_price_reduction` term, pulls vendor COG in
 * window, and runs the canonical engine.
 *
 * Engine math correctness is covered by per-engine unit tests; these
 * assertions just lock down that the wrapper assembles the right
 * RebateConfig + PeriodData and surfaces the right diagnostics.
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

import { getCapitatedRebateForContract } from "@/lib/actions/contracts/capitated"

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
    termType: "capitated_price_reduction",
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
    priceReductionTrigger: null,
    createdAt: new Date("2026-01-01"),
    tiers: [],
    ...overrides,
  }
}

describe("getCapitatedRebateForContract", () => {
  beforeEach(() => {
    contractFixture = null
    cogFixture = []
  })

  it("spend within cap: full grouped spend is eligible; embedded SPEND_REBATE pays out", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeTerm({
          periodCap: 100_000,
          groupedReferenceNumbers: ["SKU-A", "SKU-B"],
          tiers: [
            makeTier({
              tierNumber: 1,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.05, // 5% — under cap → 50k * 5% = 2500
            }),
          ],
        }),
      ],
    }
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 30_000,
        extendedPrice: 30_000,
        transactionDate: new Date("2026-03-01"),
      },
      {
        inventoryNumber: "SKU-B",
        category: null,
        quantity: 1,
        unitCost: 20_000,
        extendedPrice: 20_000,
        transactionDate: new Date("2026-04-01"),
      },
    ]
    const r = await getCapitatedRebateForContract({ contractId: "c-1" })
    expect(r.result).not.toBeNull()
    expect(r.result?.type).toBe("CAPITATED")
    // Group spend = 50k, cap = 100k → eligibleSpend = 50k, no overage warning.
    expect(r.result?.eligibleSpend).toBe(50_000)
    expect(
      r.result?.warnings.some((w) => w.includes("exceeded period cap")),
    ).toBe(false)
    // Embedded SPEND_REBATE at 5% on 50k → 2500.
    expect(r.result?.rebateEarned).toBeCloseTo(2_500, 2)
    expect(r.diagnostics.periodCap).toBe(100_000)
    expect(r.diagnostics.groupedReferenceNumberCount).toBe(2)
  })

  it("spend exceeds cap: eligibleSpend capped + overage warning emitted", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeTerm({
          periodCap: 25_000,
          groupedReferenceNumbers: ["SKU-A"],
          tiers: [
            makeTier({
              tierNumber: 1,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.05,
            }),
          ],
        }),
      ],
    }
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 100_000,
        extendedPrice: 100_000,
        transactionDate: new Date("2026-03-01"),
      },
    ]
    const r = await getCapitatedRebateForContract({ contractId: "c-1" })
    expect(r.result).not.toBeNull()
    expect(r.result?.eligibleSpend).toBe(25_000)
    expect(
      r.result?.warnings.some((w) => w.includes("exceeded period cap")),
    ).toBe(true)
  })

  it("no capitated_price_reduction term → returns null with skipReason", async () => {
    contractFixture = {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [], // Prisma include filters by termType — empty here
    }
    const r = await getCapitatedRebateForContract({ contractId: "c-1" })
    expect(r.result).toBeNull()
    expect(r.diagnostics.skipReason).toMatch(/no capitated_price_reduction term/i)
  })
})
