/**
 * Tests for getContractCapitalProjection — Wave C run-rate projection
 * for tie-in capital contracts.
 *
 * Asserts the math against a known trailing-90-day rebate stream plus
 * the two edge cases: zero rebates → payoff projection is null; run-rate
 * high enough to pay off before term end → end-of-term balance = 0 and
 * paidOffBeforeTermEnd = true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type ContractRow = {
  id: string
  effectiveDate: Date
  expirationDate: Date | null
  terms: Array<{
    capitalCost: number
    interestRate: number
    termMonths: number
    paymentTiming: string | null
  }>
}

let contractRow: ContractRow | null = null
let rebateSumTrailing90 = 0

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(async () => contractRow),
    },
    rebate: {
      aggregate: vi.fn(async () => ({
        _sum: { rebateEarned: rebateSumTrailing90 },
      })),
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
  contractOwnershipWhere: (id: string) => ({ id }),
}))

import { getContractCapitalProjection } from "@/lib/actions/contracts/tie-in"

beforeEach(() => {
  vi.clearAllMocks()
  contractRow = null
  rebateSumTrailing90 = 0
})

describe("getContractCapitalProjection", () => {
  it("returns hasProjection=false when the contract has no tie-in term", async () => {
    contractRow = {
      id: "c-1",
      effectiveDate: new Date(),
      expirationDate: null,
      terms: [],
    }
    const result = await getContractCapitalProjection("c-1")
    expect(result.hasProjection).toBe(false)
    expect(result.projectedMonthsToPayoff).toBeNull()
  })

  it("computes monthly paydown from trailing-90-day rebate stream", async () => {
    // 60 months contract, effective 30 months ago → ~half paid.
    const today = new Date()
    const effective = new Date(today)
    effective.setMonth(effective.getMonth() - 30)
    const expiration = new Date(today)
    expiration.setMonth(expiration.getMonth() + 30)

    contractRow = {
      id: "c-1",
      effectiveDate: effective,
      expirationDate: expiration,
      terms: [
        {
          capitalCost: 1_200_000,
          interestRate: 0, // zero-interest for clean principal math
          termMonths: 60,
          paymentTiming: "monthly",
        },
      ],
    }
    // $30k rebates over the last 90 days → $10k/month run rate.
    rebateSumTrailing90 = 30_000

    const result = await getContractCapitalProjection("c-1")

    expect(result.hasProjection).toBe(true)
    // monthlyPaydownRun = 30000 / 90 * 30 = 10_000
    expect(result.monthlyPaydownRun).toBeCloseTo(10_000, 2)

    // 60-month, $1.2M, 0% → $20k principal/month. 30 elapsed monthly
    // periods → $600k paid, remaining $600k.
    expect(result.remainingBalance).toBeCloseTo(600_000, 0)

    // 600_000 / 10_000 = 60 months (ceil).
    expect(result.projectedMonthsToPayoff).toBe(60)
    // ~30 months remaining × $10k = $300k; end-of-term = $600k - $300k = $300k.
    expect(result.projectedEndOfTermBalance).toBeGreaterThan(290_000)
    expect(result.projectedEndOfTermBalance).toBeLessThan(310_000)
    expect(result.paidOffBeforeTermEnd).toBe(false)
  })

  it("edge case: zero rebates → projectedMonthsToPayoff is null", async () => {
    const today = new Date()
    const effective = new Date(today)
    effective.setMonth(effective.getMonth() - 12)
    const expiration = new Date(today)
    expiration.setMonth(expiration.getMonth() + 12)

    contractRow = {
      id: "c-2",
      effectiveDate: effective,
      expirationDate: expiration,
      terms: [
        {
          capitalCost: 500_000,
          interestRate: 0,
          termMonths: 24,
          paymentTiming: "monthly",
        },
      ],
    }
    rebateSumTrailing90 = 0

    const result = await getContractCapitalProjection("c-2")
    expect(result.hasProjection).toBe(true)
    expect(result.monthlyPaydownRun).toBe(0)
    expect(result.projectedMonthsToPayoff).toBeNull()
    // No paydown → end-of-term balance ~ remaining balance; NOT paid off.
    expect(result.paidOffBeforeTermEnd).toBe(false)
  })

  it("edge case: high run-rate pays off before term end → balance=0 + flag", async () => {
    const today = new Date()
    const effective = new Date(today)
    effective.setMonth(effective.getMonth() - 6)
    const expiration = new Date(today)
    expiration.setMonth(expiration.getMonth() + 12)

    contractRow = {
      id: "c-3",
      effectiveDate: effective,
      expirationDate: expiration,
      terms: [
        {
          capitalCost: 120_000,
          interestRate: 0,
          termMonths: 24,
          paymentTiming: "monthly",
        },
      ],
    }
    // $300k / 90 days = $100k/month run-rate — vastly exceeds remaining.
    rebateSumTrailing90 = 300_000

    const result = await getContractCapitalProjection("c-3")
    expect(result.hasProjection).toBe(true)
    expect(result.monthlyPaydownRun).toBeCloseTo(100_000, 2)
    expect(result.projectedEndOfTermBalance).toBe(0)
    expect(result.paidOffBeforeTermEnd).toBe(true)
  })
})
