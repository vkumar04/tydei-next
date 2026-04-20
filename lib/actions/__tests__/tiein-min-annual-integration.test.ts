/**
 * Charles W1.Y-D integration test — tie-in minimum annual purchase +
 * capital-retirement math surfaced through `getContractCapitalSchedule`.
 *
 * Verifies:
 *   1. Rolling-12 spend < minAnnualPurchase → `computeMinAnnualShortfall`
 *      returns met=false with the right gap.
 *   2. With remaining capital and a positive tier rate,
 *      `computeCapitalRetirementNeeded` returns a positive annual spend
 *      needed.
 *   3. The server-action bundle (`getContractCapitalSchedule`) surfaces
 *      the inputs (rolling12Spend, minAnnualPurchase, monthsRemaining,
 *      currentTierPercent, capitalCost, rebateAppliedToCapital) so the
 *      card can run the math without any ad-hoc reducer.
 *
 * Pattern: `vi.mock("@/lib/db")` per CLAUDE.md — no DB hit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { computeMinAnnualShortfall } from "@/lib/contracts/min-annual-shortfall"
import { computeCapitalRetirementNeeded } from "@/lib/contracts/capital-retirement-needed"

type TermRow = {
  minimumPurchaseCommitment: number | null
  rebateMethod: string
  tiers: Array<{
    tierNumber: number
    spendMin: number
    spendMax: number | null
    rebateValue: number
    rebateType: string
  }>
}

type ContractRow = {
  id: string
  contractType: string
  vendorId: string
  effectiveDate: Date
  capitalCost: number
  interestRate: number
  termMonths: number
  paymentCadence: string
  amortizationShape: string
  amortizationRows: Array<unknown>
  rebates: Array<{ collectionDate: Date | null; rebateCollected: number }>
  terms: TermRow[]
}

let contractRow: ContractRow | null = null
let cogAggValue = 0
let cogVendorAggValue = 0
let periodAggValue = 0

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(async () => contractRow),
    },
    cOGRecord: {
      aggregate: vi.fn(async (args: { where: { contractId?: string } }) => ({
        _sum: {
          extendedPrice: args.where.contractId ? cogAggValue : cogVendorAggValue,
        },
      })),
    },
    contractPeriod: {
      aggregate: vi.fn(async () => ({ _sum: { totalSpend: periodAggValue } })),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: vi.fn((id: string) => ({ id })),
  contractsOwnedByFacility: vi.fn(() => ({})),
  facilityScopeClause: vi.fn(() => ({})),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

beforeEach(() => {
  vi.clearAllMocks()
  contractRow = null
  cogAggValue = 0
  cogVendorAggValue = 0
  periodAggValue = 0
})

describe("tie-in min-annual + retirement integration", () => {
  it("surfaces the rolling-12 shortfall + retirement math (Charles iMessage 2026-04-20)", async () => {
    // Scenario: capital $300k over 60 months at 5% tier. Thirty months
    // in, rolling-12 = $312,056 but Charles's floor = $400,000. The
    // card must show an unmet shortfall and a positive annual spend
    // needed to retire capital.
    const CAPITAL = 300_000
    const MIN_ANNUAL = 400_000
    const ROLLING12 = 312_056
    const COLLECTED_REBATE = 30_000 // rebate already applied to capital
    const TIER_PERCENT = 5 // 5%
    const TERM_MONTHS = 60

    contractRow = {
      id: "c-tiein-w1yd",
      contractType: "tie_in",
      vendorId: "v-test",
      // effectiveDate 30 months ago → 30 elapsed, 30 remaining.
      effectiveDate: (() => {
        const d = new Date()
        d.setMonth(d.getMonth() - 30)
        return d
      })(),
      capitalCost: CAPITAL,
      interestRate: 0.05,
      termMonths: TERM_MONTHS,
      paymentCadence: "monthly",
      amortizationShape: "symmetrical",
      amortizationRows: [],
      rebates: [
        {
          rebateCollected: COLLECTED_REBATE,
          collectionDate: new Date("2025-01-15"),
        },
      ],
      terms: [
        {
          minimumPurchaseCommitment: MIN_ANNUAL,
          rebateMethod: "cumulative",
          // Single tier covering all spend at 5% (stored as FRACTION per
          // rebate-units convention; 0.05 = 5% after ×100 scaling).
          tiers: [
            {
              tierNumber: 1,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.05,
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    }
    // Rolling-12 cascade prefers ContractPeriod → COG-contract → COG-vendor.
    // Use the contract-scoped COG path.
    cogAggValue = ROLLING12

    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const result = await getContractCapitalSchedule("c-tiein-w1yd")

    // Bundle surfaces the correct inputs for the card.
    expect(result.contractType).toBe("tie_in")
    expect(result.minAnnualPurchase).toBe(MIN_ANNUAL)
    expect(result.rolling12Spend).toBe(ROLLING12)
    expect(result.currentTierPercent).toBe(TIER_PERCENT)
    expect(result.capitalCost).toBe(CAPITAL)
    expect(result.rebateAppliedToCapital).toBe(COLLECTED_REBATE)
    expect(result.monthsRemaining).toBeGreaterThan(0)

    // Shortfall math — floor is $400k, spend is $312,056, gap = 87,944.
    const shortfall = computeMinAnnualShortfall(
      result.rolling12Spend,
      result.minAnnualPurchase,
    )
    expect(shortfall.met).toBe(false)
    expect(shortfall.gap).toBe(MIN_ANNUAL - ROLLING12)

    // Retirement math — remaining $270k over monthsRemaining months at 5%,
    // annualSpendNeeded must be a positive finite number.
    const retirement = computeCapitalRetirementNeeded({
      capitalAmount: result.capitalCost,
      rebatesApplied: result.rebateAppliedToCapital,
      monthsRemaining: result.monthsRemaining,
      rebatePercent: result.currentTierPercent,
    })
    expect(retirement.remainingCapital).toBe(CAPITAL - COLLECTED_REBATE)
    expect(retirement.annualSpendNeeded).not.toBeNull()
    expect(retirement.annualSpendNeeded).toBeGreaterThan(0)
  })
})
