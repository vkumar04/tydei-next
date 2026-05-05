/**
 * Integration tests for `getTieInCapitalForContractPeriod`.
 *
 * Mocks Prisma + auth at the module boundary. The wrapper builds a
 * `TieInCapitalConfig` from the contract's first capital line item +
 * first SPEND_REBATE-shaped term, runs the per-period evaluator, and
 * returns the standardized RebateResult.
 *
 * Engine math correctness is covered by per-engine unit tests; these
 * assertions just lock down that the wrapper assembles the right
 * config + correctly handles the multi-line guard.
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

type FakeCapitalLineItem = {
  id: string
  description: string
  itemNumber: string | null
  serialNumber: string | null
  contractTotal: number
  initialSales: number | null
  interestRate: number | null
  termMonths: number | null
  paymentType: string
  paymentCadence: string
  createdAt: Date
}

type FakeContract = {
  id: string
  name: string
  vendorId: string
  contractType: string
  effectiveDate: Date
  expirationDate: Date
  terms: FakeTerm[]
  capitalLineItems: FakeCapitalLineItem[]
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

import { getTieInCapitalForContractPeriod } from "@/lib/actions/contracts/tie-in-period"

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

function makeSpendTerm(tiers: FakeTier[]): FakeTerm {
  return {
    id: "term-1",
    termType: "spend_rebate",
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
    tiers,
  }
}

function makeCapitalItem(
  overrides: Partial<FakeCapitalLineItem>,
): FakeCapitalLineItem {
  return {
    id: "cli-1",
    description: "Imaging system",
    itemNumber: null,
    serialNumber: null,
    contractTotal: 120_000,
    initialSales: 0,
    interestRate: 0,
    termMonths: 12,
    paymentType: "fixed",
    paymentCadence: "monthly",
    createdAt: new Date("2026-01-01"),
    ...overrides,
  }
}

describe("getTieInCapitalForContractPeriod", () => {
  beforeEach(() => {
    contractFixture = null
    cogFixture = []
  })

  it("single-line capital + sufficient rebate → shortfall = 0, schedule entry returned", async () => {
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 0.5, // 50% — guarantees rebate covers monthly amort
          }),
        ]),
      ],
      capitalLineItems: [
        makeCapitalItem({
          contractTotal: 120_000,
          interestRate: 0, // monthly amort = 10k
          termMonths: 12,
        }),
      ],
    }
    // Massive spend → 50% rebate covers the 10k monthly amort easily.
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 1_000_000,
        extendedPrice: 1_000_000,
        transactionDate: new Date("2026-02-01"),
      },
    ]
    const r = await getTieInCapitalForContractPeriod({
      contractId: "c-1",
      periodNumber: 1,
    })
    expect(r.result).not.toBeNull()
    expect(r.result?.type).toBe("TIE_IN_CAPITAL")
    expect(r.result?.amortizationEntry).not.toBeNull()
    expect(r.result?.amortizationEntry?.amortizationDue).toBeCloseTo(10_000, 2)
    // rebate >> scheduled → trueUpAdjustment <= 0 (over-accrued / surplus).
    expect(r.result?.trueUpAdjustment).toBeLessThanOrEqual(0)
    // No CARRY_FORWARD shortfall warning when no shortfall.
    expect(
      r.result?.warnings.some((w) => w.includes("carried forward")),
    ).toBe(false)
  })

  it("single-line capital + insufficient rebate (CARRY_FORWARD) → shortfall warning emitted", async () => {
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 0.01, // 1% — tiny rebate, will undershoot 10k amort
          }),
        ]),
      ],
      capitalLineItems: [
        makeCapitalItem({
          contractTotal: 120_000,
          interestRate: 0,
          termMonths: 12,
        }),
      ],
    }
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 50_000,
        extendedPrice: 50_000, // 1% = 500 → 9500 shortfall vs 10k amort
        transactionDate: new Date("2026-02-01"),
      },
    ]
    const r = await getTieInCapitalForContractPeriod({
      contractId: "c-1",
      periodNumber: 1,
    })
    expect(r.result).not.toBeNull()
    expect(r.result?.trueUpAdjustment).toBeGreaterThan(0)
    // Wrapper hard-codes shortfallHandling: "CARRY_FORWARD" → carried-forward warning.
    expect(
      r.result?.warnings.some((w) => w.includes("carried forward")),
    ).toBe(true)
  })

  it("multi-line capital → returns null with skipReason pointing at getContractCapitalSchedule", async () => {
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({ tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 0.05 }),
        ]),
      ],
      capitalLineItems: [
        makeCapitalItem({ id: "cli-1" }),
        makeCapitalItem({ id: "cli-2", description: "Second device" }),
      ],
    }
    const r = await getTieInCapitalForContractPeriod({ contractId: "c-1" })
    expect(r.result).toBeNull()
    expect(r.diagnostics.skipReason).toMatch(/multi-line capital/i)
    expect(r.diagnostics.skipReason).toMatch(/getContractCapitalSchedule/)
  })
})
