import { describe, it, expect } from "vitest"
import {
  projectAnnualSpend,
  type MonthlySpendObservation,
} from "../spend-projection"

// Reference: 2026-04-15 → month index 3 (April).
// remainingMonthsInYear = 12 - 3 - 1 = 8.
const ref = new Date("2026-04-15T00:00:00Z")

describe("projectAnnualSpend", () => {
  it("handles empty history with zero current-month-to-date", () => {
    const p = projectAnnualSpend({
      history: [],
      currentMonthToDate: 0,
      referenceDate: ref,
    })
    expect(p.projectedAnnualSpend).toBe(0)
    expect(p.trailing3MonthAvg).toBe(0)
    expect(p.currentMonthToDate).toBe(0)
    expect(p.remainingMonthsInYear).toBe(8)
    expect(p.trend).toBe("FLAT")
  })

  it("handles a single-month history (trailing avg is that one month)", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2026-03", spend: 900 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 100,
      referenceDate: ref,
    })
    expect(p.trailing3MonthAvg).toBe(900)
    expect(p.currentMonthToDate).toBe(100)
    // sum(this-year full months) + currentMTD + remainingMonths × trailingAvg
    // = 900 + 100 + 8 × 900 = 8200
    expect(p.projectedAnnualSpend).toBe(8200)
    expect(p.trend).toBe("FLAT") // prior avg is 0
  })

  it("computes trailing3MonthAvg over the last 3 full months", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2026-01", spend: 1000 },
      { month: "2026-02", spend: 1500 },
      { month: "2026-03", spend: 2000 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 500,
      referenceDate: ref,
    })
    expect(p.trailing3MonthAvg).toBe(1500)
    // this-year full months sum = 4500; + 500 MTD; + 8 × 1500 = 17000
    expect(p.projectedAnnualSpend).toBe(17000)
    expect(p.trend).toBe("FLAT") // prior3 avg is 0 → FLAT
  })

  it("detects an UP trend when trailing > prior by more than 5%", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2025-10", spend: 1000 },
      { month: "2025-11", spend: 1000 },
      { month: "2025-12", spend: 1000 },
      { month: "2026-01", spend: 1100 },
      { month: "2026-02", spend: 1100 },
      { month: "2026-03", spend: 1100 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 0,
      referenceDate: ref,
    })
    expect(p.trailing3MonthAvg).toBe(1100)
    expect(p.trend).toBe("UP")
  })

  it("detects a DOWN trend when trailing < prior by more than 5%", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2025-10", spend: 2000 },
      { month: "2025-11", spend: 2000 },
      { month: "2025-12", spend: 2000 },
      { month: "2026-01", spend: 1800 },
      { month: "2026-02", spend: 1800 },
      { month: "2026-03", spend: 1800 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 0,
      referenceDate: ref,
    })
    expect(p.trend).toBe("DOWN")
  })

  it("reports FLAT when the trailing vs prior delta is within ±5%", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2025-10", spend: 1000 },
      { month: "2025-11", spend: 1000 },
      { month: "2025-12", spend: 1000 },
      { month: "2026-01", spend: 1020 },
      { month: "2026-02", spend: 1020 },
      { month: "2026-03", spend: 1020 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 0,
      referenceDate: ref,
    })
    // delta = +2% → FLAT
    expect(p.trend).toBe("FLAT")
  })

  it("returns FLAT safely when the prior3 avg is zero", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2025-10", spend: 0 },
      { month: "2025-11", spend: 0 },
      { month: "2025-12", spend: 0 },
      { month: "2026-01", spend: 100 },
      { month: "2026-02", spend: 200 },
      { month: "2026-03", spend: 300 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 0,
      referenceDate: ref,
    })
    expect(p.trend).toBe("FLAT")
  })

  it("includes currentMonthToDate in the projected annual spend", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2026-01", spend: 1000 },
      { month: "2026-02", spend: 1000 },
      { month: "2026-03", spend: 1000 },
    ]
    const noMTD = projectAnnualSpend({
      history,
      currentMonthToDate: 0,
      referenceDate: ref,
    })
    const withMTD = projectAnnualSpend({
      history,
      currentMonthToDate: 400,
      referenceDate: ref,
    })
    expect(withMTD.projectedAnnualSpend - noMTD.projectedAnnualSpend).toBe(400)
    expect(withMTD.currentMonthToDate).toBe(400)
  })

  it("excludes observations for the current month from trailing averages", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2026-01", spend: 1000 },
      { month: "2026-02", spend: 1000 },
      { month: "2026-03", spend: 1000 },
      // Stray current-month row; should be dropped.
      { month: "2026-04", spend: 9999 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 200,
      referenceDate: ref,
    })
    expect(p.trailing3MonthAvg).toBe(1000)
    expect(p.currentMonthToDate).toBe(200)
  })

  it("sorts history ascending before slicing", () => {
    const history: MonthlySpendObservation[] = [
      { month: "2026-03", spend: 3000 },
      { month: "2026-01", spend: 1000 },
      { month: "2026-02", spend: 2000 },
    ]
    const p = projectAnnualSpend({
      history,
      currentMonthToDate: 0,
      referenceDate: ref,
    })
    // Trailing 3 should be 1000, 2000, 3000 → avg 2000.
    expect(p.trailing3MonthAvg).toBe(2000)
  })

  it("computes remainingMonthsInYear correctly near year boundaries", () => {
    const jan = projectAnnualSpend({
      history: [],
      currentMonthToDate: 0,
      referenceDate: new Date("2026-01-15T00:00:00Z"),
    })
    expect(jan.remainingMonthsInYear).toBe(11)

    const dec = projectAnnualSpend({
      history: [],
      currentMonthToDate: 0,
      referenceDate: new Date("2026-12-15T00:00:00Z"),
    })
    expect(dec.remainingMonthsInYear).toBe(0)
  })
})
