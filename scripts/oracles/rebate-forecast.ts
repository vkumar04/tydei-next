// scripts/oracles/rebate-forecast.ts
/**
 * Rebate forecast oracle (independent validator).
 *
 * Mock-driven: builds synthetic monthly-spend history + a mock tier
 * ladder, runs the canonical forecast engine
 * (`computeRebateForecast`), then independently re-derives a naive
 * trailing-extrapolation forecast and asserts the engine's output is
 * within reasonable bounds.
 *
 * Goal: catch the silent-zero class (PR #82 — wrong term type picked,
 * forecast went flat $0) and tier-projection bugs without trying to
 * match the engine's regression+seasonality precision.
 *
 * No DB, no auth. Runs deterministically on any machine.
 */
import { defineOracle } from "./_shared/runner"
import {
  computeRebateForecast,
  type ForecastTermLike,
} from "@/lib/contracts/rebate-forecast-engine"

interface MockScenario {
  label: string
  /** YYYY-MM → spend $. The oracle synthesizes 18 months of history. */
  monthlySpend: Map<string, number>
  terms: ForecastTermLike[]
  expectations: {
    /** Lower bound on forecast spend sum, expressed as fraction of
     *  trailing-12mo extrapolation. 0.5 = "must be at least 50% of
     *  naive extrapolation". */
    minSpendFraction: number
    /** True if any historical spend should yield non-zero forecast
     *  rebate (catches #82 silent-zero). */
    requireNonZeroRebate: boolean
  }
}

function buildHistory(
  startKey: string,
  months: number,
  baseSpend: number,
  growthFactor = 0.02,
): Map<string, number> {
  const out = new Map<string, number>()
  const [yStr, mStr] = startKey.split("-")
  let y = Number(yStr)
  let m = Number(mStr)
  for (let i = 0; i < months; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`
    const seasonal = 1 + 0.1 * Math.sin((i / 12) * 2 * Math.PI)
    out.set(key, baseSpend * seasonal * Math.pow(1 + growthFactor, i))
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

const SPEND_TERM: ForecastTermLike = {
  termType: "spend_rebate",
  tiers: [
    { tierNumber: 1, spendMin: 0, rebateValue: 0.02 },
    { tierNumber: 2, spendMin: 250_000, rebateValue: 0.03 },
    { tierNumber: 3, spendMin: 500_000, rebateValue: 0.04 },
  ],
}

const VOLUME_TERM_BAD_FOR_FORECAST: ForecastTermLike = {
  // PR #82 reproduction: a volume_rebate term (non-dollar tiers) used
  // to force the forecast to $0 because the engine took terms[0]. The
  // engine now filters to spend-based terms — this fixture verifies
  // the regression doesn't return when both kinds of terms are
  // present and the volume term comes first.
  termType: "volume_rebate",
  tiers: [
    { tierNumber: 1, spendMin: 0, rebateValue: 0.01 },
    { tierNumber: 2, spendMin: 5_000_000, rebateValue: 0.02 },
  ],
}

const SCENARIOS: MockScenario[] = [
  {
    label: "spend_rebate only (baseline)",
    monthlySpend: buildHistory("2025-01", 18, 50_000),
    terms: [SPEND_TERM],
    expectations: { minSpendFraction: 0.5, requireNonZeroRebate: true },
  },
  {
    label: "volume_rebate first + spend_rebate second (PR #82 regression)",
    monthlySpend: buildHistory("2025-01", 18, 50_000),
    terms: [VOLUME_TERM_BAD_FOR_FORECAST, SPEND_TERM],
    expectations: { minSpendFraction: 0.5, requireNonZeroRebate: true },
  },
  {
    label: "no spend_rebate term (engine falls back to first w/ tiers)",
    monthlySpend: buildHistory("2025-01", 18, 50_000),
    terms: [VOLUME_TERM_BAD_FOR_FORECAST],
    expectations: { minSpendFraction: 0.5, requireNonZeroRebate: false },
  },
  {
    label: "<3 months history (engine returns empty)",
    monthlySpend: buildHistory("2025-01", 2, 50_000),
    terms: [SPEND_TERM],
    expectations: { minSpendFraction: 0, requireNonZeroRebate: false },
  },
]

export default defineOracle("rebate-forecast", async (ctx) => {
  for (const s of SCENARIOS) {
    const forecast = computeRebateForecast({
      monthlySpend: s.monthlySpend,
      terms: s.terms,
      forecastMonths: 12,
    })

    const histValues = Array.from(s.monthlySpend.values())
    const trailingTotal = histValues.reduce((a, b) => a + b, 0)
    const oracleAvgMonthly =
      histValues.length > 0 ? trailingTotal / histValues.length : 0
    const oracleProjected12mo = oracleAvgMonthly * 12

    const appSpendSum = forecast.forecast.reduce((a, p) => a + p.spend, 0)
    const appRebateSum = forecast.forecast.reduce(
      (a, p) => a + p.rebateForPeriod,
      0,
    )

    if (histValues.length < 3) {
      ctx.check(
        `[${s.label}] short-history returns empty forecast`,
        forecast.forecast.length === 0 && forecast.history.length === 0,
        `forecast.length=${forecast.forecast.length} history.length=${forecast.history.length}`,
      )
      continue
    }

    ctx.check(
      `[${s.label}] forecast has 12 monthly points`,
      forecast.forecast.length === 12,
      `got ${forecast.forecast.length}`,
    )

    ctx.check(
      `[${s.label}] history points are flagged isForecast=false`,
      forecast.history.every((p) => !p.isForecast),
      `${forecast.history.filter((p) => p.isForecast).length} of ${forecast.history.length} wrongly flagged forecast`,
    )

    ctx.check(
      `[${s.label}] forecast points are flagged isForecast=true`,
      forecast.forecast.every((p) => p.isForecast),
      `${forecast.forecast.filter((p) => !p.isForecast).length} of ${forecast.forecast.length} wrongly flagged history`,
    )

    if (s.expectations.minSpendFraction > 0) {
      const minAcceptable =
        oracleProjected12mo * s.expectations.minSpendFraction
      ctx.check(
        `[${s.label}] forecast spend ≥ ${(s.expectations.minSpendFraction * 100).toFixed(0)}% of trailing extrapolation`,
        appSpendSum >= minAcceptable,
        `app=$${appSpendSum.toFixed(0)} oracle-min=$${minAcceptable.toFixed(0)} (trailing-avg=$${oracleAvgMonthly.toFixed(0)}/mo)`,
      )
    }

    if (s.expectations.requireNonZeroRebate) {
      ctx.check(
        `[${s.label}] forecast rebate sum is non-zero (PR #82 silent-zero detector)`,
        appRebateSum > 0,
        `app rebate sum=$${appRebateSum.toFixed(2)} (spend sum=$${appSpendSum.toFixed(0)})`,
      )
    }

    ctx.check(
      `[${s.label}] cumulativeYtdSpend resets across year boundaries`,
      (() => {
        let prev = -1
        let prevYear = ""
        for (const p of [...forecast.history, ...forecast.forecast]) {
          const year = p.period.slice(0, 4)
          if (year !== prevYear) {
            // Should reset.
            if (p.cumulativeYtdSpend < p.spend - 0.01) return false
          } else {
            // Should be monotonic non-decreasing.
            if (p.cumulativeYtdSpend < prev - 0.01) return false
          }
          prev = p.cumulativeYtdSpend
          prevYear = year
        }
        return true
      })(),
      "cumulative YTD spend should reset at Jan and never decrease within a year",
    )
  }
})
