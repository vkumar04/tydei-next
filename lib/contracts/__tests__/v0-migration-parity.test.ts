/**
 * Golden-value parity for the 2026-07-29 `lib/v0-spec/` migration.
 *
 * These expectations were CAPTURED FROM THE OLD MODULE before it was deleted,
 * by running every migrated function over the input set below and recording
 * what it returned. They are not re-derived from the new code — that would
 * make the test tautological. If a refactor changes any number here, it has
 * changed production math, and that is the point of the file.
 *
 * The input set deliberately leans on the cases that break arithmetic:
 * exact tier/threshold boundaries, zero and empty inputs, zero denominators,
 * and both sides of every clamp.
 */

import { describe, it, expect } from "vitest"
import {
  tieInAllOrNothing,
  tieInProportional,
  crossVendorTieIn,
} from "../tie-in-bundle-math"
import { cogPriceVarianceBand, spendTrend } from "../cog-variance-band"
import { spendConcentration, renewalRisk } from "../performance-metrics"
import { serviceSlaPenalty } from "../sla-penalty"

describe("cogPriceVarianceBand — golden", () => {
  it.each([
    // paid, contract, expected variancePct, expected band
    [0, 100, -100, "significant_discount"],
    [1, 100, -99, "significant_discount"],
    [100, 100, 0, "at_contract"],
    [95, 100, -5, "significant_discount"], // boundary: -5 is SIGNIFICANT, not minor
    [94.9, 100, -5.100000000000009, "significant_discount"],
    [105, 100, 4.999999999999993, "minor_overcharge"], // boundary: 5 is MINOR
    [105.1, 100, 5.099999999999994, "significant_overcharge"],
  ])("(%s vs %s) -> %s%% %s", (paid, contract, pct, band) => {
    const r = cogPriceVarianceBand(paid as number, contract as number)
    expect(r.variancePct).toBeCloseTo(pct as number, 10)
    expect(r.band).toBe(band)
  })

  it("treats a non-positive contract price as at_contract, not Infinity", () => {
    expect(cogPriceVarianceBand(50, 0)).toEqual({
      variancePct: 0,
      band: "at_contract",
    })
  })
})

describe("spendTrend — golden", () => {
  it.each([
    [[1, 1, 1, 1, 1, 1], 0, "stable"],
    [[1, 1, 1, 2, 2, 2], 100, "up"],
    [[2, 2, 2, 1, 1, 1], -50, "down"],
    [[0, 0, 0, 1, 1, 1], 0, "stable"], // zero prior base -> stable, not Infinity
    [[1, 2, 3, 4, 5], 0, "stable"], // < 6 points -> no opinion
  ])("%j -> %s%% %s", (series, pct, trend) => {
    const r = spendTrend(series as number[])
    expect(r.changePct).toBeCloseTo(pct as number, 10)
    expect(r.trend).toBe(trend)
  })
})

describe("spendConcentration — golden", () => {
  it("empty input is zeroed, not NaN", () => {
    expect(spendConcentration([])).toEqual({
      hhi: 0,
      level: "low",
      topVendorSharePct: 0,
      top3SharePct: 0,
    })
  })

  it("all-zero spend is zeroed, not NaN", () => {
    expect(
      spendConcentration([
        { vendorId: "a", spend: 0 },
        { vendorId: "b", spend: 0 },
      ]),
    ).toEqual({ hhi: 0, level: "low", topVendorSharePct: 0, top3SharePct: 0 })
  })

  it("a monopoly scores 10,000 — the percent scale the bands assume", () => {
    const r = spendConcentration([{ vendorId: "a", spend: 100 }])
    expect(r.hhi).toBeCloseTo(10000, 6)
    expect(r.level).toBe("high")
    expect(r.topVendorSharePct).toBeCloseTo(100, 6)
  })

  it("an even duopoly is 5,000 -> high", () => {
    const r = spendConcentration([
      { vendorId: "a", spend: 50 },
      { vendorId: "b", spend: 50 },
    ])
    expect(r.hhi).toBeCloseTo(5000, 6)
    expect(r.level).toBe("high")
  })

  it("90/5/5 -> 8150, top3 = 100", () => {
    const r = spendConcentration([
      { vendorId: "a", spend: 90 },
      { vendorId: "b", spend: 5 },
      { vendorId: "c", spend: 5 },
    ])
    expect(r.hhi).toBeCloseTo(8150, 6)
    expect(r.topVendorSharePct).toBeCloseTo(90, 6)
    expect(r.top3SharePct).toBeCloseTo(100, 6)
  })
})

describe("renewalRisk — golden", () => {
  it("weights sum to exactly 1 — the 0-100 scale depends on it", () => {
    // All sub-scores saturated at 100 must yield exactly 100.
    const r = renewalRisk({
      daysRemaining: 0,
      compliancePct: 0,
      avgPriceVariancePct: 100,
      avgResponseTimeHours: 1000,
      rebateUtilizationPct: 0,
      openIssues: 99,
    })
    expect(r.riskScore).toBeCloseTo(100, 10)
    expect(r.riskLevel).toBe("high")
  })

  it("the healthiest possible contract scores 5.625 -> low", () => {
    const r = renewalRisk({
      daysRemaining: 365,
      compliancePct: 100,
      avgPriceVariancePct: 0,
      avgResponseTimeHours: 1,
      rebateUtilizationPct: 100,
      openIssues: 0,
    })
    expect(r.riskScore).toBeCloseTo(5.625, 10)
    expect(r.riskLevel).toBe("low")
  })

  it("mid-range case -> 68.5 high", () => {
    const r = renewalRisk({
      daysRemaining: 10,
      compliancePct: 50,
      avgPriceVariancePct: 5,
      avgResponseTimeHours: 48,
      rebateUtilizationPct: 20,
      openIssues: 3,
    })
    expect(r.riskScore).toBeCloseTo(68.5, 10)
    expect(r.riskLevel).toBe("high")
  })
})

describe("tieInAllOrNothing — golden", () => {
  const bundle = { baseRate: 2, bonusRate: 1, acceleratorMultiplier: 1.5 }

  it("exactly at minimums -> compliant at base rate", () => {
    const r = tieInAllOrNothing(
      [
        { minimumSpend: 100, currentSpend: 100 },
        { minimumSpend: 100, currentSpend: 100 },
      ],
      bundle,
    )
    expect(r).toEqual({
      compliant: true,
      totalSpend: 200,
      applicableRate: 2,
      rebateEarned: 4,
      bonusLevel: "base",
    })
  })

  it("one member $1 short zeroes the WHOLE bundle", () => {
    const r = tieInAllOrNothing(
      [
        { minimumSpend: 100, currentSpend: 99 },
        { minimumSpend: 100, currentSpend: 200 },
      ],
      bundle,
    )
    expect(r.compliant).toBe(false)
    expect(r.rebateEarned).toBe(0)
    expect(r.applicableRate).toBe(0)
    expect(r.totalSpend).toBe(299) // spend still reported
  })

  it("120% of minimum -> bonus tier (base + bonus)", () => {
    const r = tieInAllOrNothing(
      [
        { minimumSpend: 100, currentSpend: 120 },
        { minimumSpend: 100, currentSpend: 120 },
      ],
      bundle,
    )
    expect(r.bonusLevel).toBe("bonus")
    expect(r.applicableRate).toBe(3)
    expect(r.rebateEarned).toBeCloseTo(7.2, 10)
  })

  it("150% of minimum -> accelerator ((base+bonus) x multiplier)", () => {
    const r = tieInAllOrNothing(
      [
        { minimumSpend: 100, currentSpend: 150 },
        { minimumSpend: 100, currentSpend: 150 },
      ],
      bundle,
    )
    expect(r.bonusLevel).toBe("accelerator")
    expect(r.applicableRate).toBeCloseTo(4.5, 10)
    expect(r.rebateEarned).toBeCloseTo(13.5, 10)
  })

  it("a zero minimum is trivially met at zero spend", () => {
    const r = tieInAllOrNothing([{ minimumSpend: 0, currentSpend: 0 }], bundle)
    expect(r.compliant).toBe(true)
    expect(r.bonusLevel).toBe("accelerator") // 0 >= 0*1.5 holds
    expect(r.rebateEarned).toBe(0)
  })
})

describe("tieInProportional — golden", () => {
  it("the documented 80/100/80 case -> 0.88 overall, $1,548.80", () => {
    const r = tieInProportional(
      [
        { minimumSpend: 25000, currentSpend: 20000, weight: 0.3 },
        { minimumSpend: 40000, currentSpend: 40000, weight: 0.4 },
        { minimumSpend: 35000, currentSpend: 28000, weight: 0.3 },
      ],
      2,
    )
    expect(r.overallCompliance).toBeCloseTo(0.88, 10)
    expect(r.totalSpend).toBe(88000)
    expect(r.effectiveRate).toBeCloseTo(1.76, 10)
    expect(r.rebateEarned).toBeCloseTo(1548.8, 8)
  })

  it("a zero-minimum member contributes ZERO compliance (opposite of all-or-nothing)", () => {
    // Documented asymmetry, preserved verbatim from the original.
    const r = tieInProportional(
      [{ minimumSpend: 0, currentSpend: 100, weight: 1 }],
      2,
    )
    expect(r.overallCompliance).toBe(0)
    expect(r.effectiveRate).toBe(0)
    expect(r.rebateEarned).toBe(0)
  })
})

describe("crossVendorTieIn — golden", () => {
  it("all three at exact minimums -> $4,625 vendor + $2,250 bonus = $6,875", () => {
    const r = crossVendorTieIn(
      [
        { vendorId: "1", vendorName: "Suture Co", minimumSpend: 50000, rebateContribution: 2, currentSpend: 50000 },
        { vendorId: "2", vendorName: "Implant Inc", minimumSpend: 100000, rebateContribution: 2.5, currentSpend: 100000 },
        { vendorId: "3", vendorName: "Equipment Ltd", minimumSpend: 75000, rebateContribution: 1.5, currentSpend: 75000 },
      ],
      { rate: 1, requirement: "all_compliant" },
    )
    expect(r.vendorRebateTotal).toBeCloseTo(4625, 8)
    expect(r.facilityBonus).toBeCloseTo(2250, 8)
    expect(r.totalRebate).toBeCloseTo(6875, 8)
    expect(r.allCompliant).toBe(true)
    expect(r.totalSpend).toBe(225000)
  })

  it("one vendor short: the others still earn, the bonus does not", () => {
    const r = crossVendorTieIn(
      [
        { vendorId: "1", vendorName: "A", minimumSpend: 50000, rebateContribution: 2, currentSpend: 40000 },
        { vendorId: "2", vendorName: "B", minimumSpend: 100000, rebateContribution: 2.5, currentSpend: 100000 },
      ],
      { rate: 1, requirement: "all_compliant" },
    )
    expect(r.allCompliant).toBe(false)
    expect(r.facilityBonus).toBe(0)
    expect(r.vendorRebates[0]!.rebate).toBe(0)
    expect(r.vendorRebates[0]!.shortfall).toBe(10000)
    expect(r.vendorRebates[1]!.rebate).toBeCloseTo(2500, 8)
    expect(r.totalRebate).toBeCloseTo(2500, 8)
  })
})

describe("serviceSlaPenalty — golden", () => {
  it("late AND under uptime -> both penalties, summed", () => {
    const r = serviceSlaPenalty({
      actualResponseHours: 10,
      slaResponseHours: 4,
      hourlyPenaltyRate: 50,
      actualUptimePct: 98,
      slaUptimePct: 99.5,
      annualFee: 120000,
    })
    expect(r.responsePenalty).toBeCloseTo(300, 8) // (10-4) x 50
    expect(r.uptimePenalty).toBeCloseTo(1800, 8) // 120000 x 1.5/100
    expect(r.totalPenalty).toBeCloseTo(2100, 8)
  })

  it("beating both SLAs earns no credit — penalties are one-sided", () => {
    const r = serviceSlaPenalty({
      actualResponseHours: 1,
      slaResponseHours: 4,
      hourlyPenaltyRate: 50,
      actualUptimePct: 100,
      slaUptimePct: 99.5,
      annualFee: 120000,
    })
    expect(r).toEqual({
      responsePenalty: 0,
      uptimePenalty: 0,
      totalPenalty: 0,
    })
  })
})
