import { describe, it, expect } from "vitest"
import {
  buildShortfallWaterfall,
  type ShortfallPeriodInput,
} from "@/lib/contracts/tie-in-shortfall-waterfall"

const PERIODS: ShortfallPeriodInput[] = [
  { periodNumber: 1, scheduledDueBase: 1000, rebateEarned: 600 },
  { periodNumber: 2, scheduledDueBase: 1000, rebateEarned: 1500 },
  { periodNumber: 3, scheduledDueBase: 1000, rebateEarned: 800 },
]

describe("buildShortfallWaterfall — carry_forward", () => {
  const rows = buildShortfallWaterfall(PERIODS, "carry_forward")

  it("P1: shortfall 400 carries forward", () => {
    expect(rows[0]).toMatchObject({
      periodNumber: 1,
      scheduledDue: 1000,
      rebateEarned: 600,
      periodShortfall: 400,
      carriedForwardBalance: 0,
      runningBalance: 400,
    })
  })

  it("P2: scheduledDue 1400 (1000 + 400 carry-in), over-accrual clears balance", () => {
    expect(rows[1]).toMatchObject({
      periodNumber: 2,
      scheduledDue: 1400,
      rebateEarned: 1500,
      periodShortfall: -100,
      carriedForwardBalance: 400,
      runningBalance: 0,
    })
  })

  it("P3: nothing carried in, shortfall 200 carries forward", () => {
    expect(rows[2]).toMatchObject({
      periodNumber: 3,
      scheduledDue: 1000,
      rebateEarned: 800,
      periodShortfall: 200,
      carriedForwardBalance: 0,
      runningBalance: 200,
    })
  })
})

describe("buildShortfallWaterfall — bill_immediately", () => {
  const rows = buildShortfallWaterfall(PERIODS, "bill_immediately")

  it("every scheduledDue equals base, nothing ever carries", () => {
    for (const row of rows) {
      expect(row.scheduledDue).toBe(1000)
      expect(row.carriedForwardBalance).toBe(0)
      expect(row.runningBalance).toBe(0)
    }
  })

  it("periodShortfall is still computed against base", () => {
    expect(rows.map((r) => r.periodShortfall)).toEqual([400, -500, 200])
  })
})

describe("buildShortfallWaterfall — edge cases", () => {
  it("empty array → []", () => {
    expect(buildShortfallWaterfall([], "carry_forward")).toEqual([])
    expect(buildShortfallWaterfall([], "bill_immediately")).toEqual([])
  })
})
