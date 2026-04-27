// scripts/oracles/rebate-forecast.ts
/**
 * Rebate forecast oracle (gross-drift detector).
 *
 * Computes a naive 12-month projection from the contract's trailing
 * spend and asserts the app's forecast curve has the right shape and
 * non-zero magnitude when the contract has historical spend.
 *
 * Designed to catch the #82 silent-zero class — flat $0 line because
 * the wrong term type was selected — without trying to match the app's
 * regression+seasonality precision. Tolerates ±50% drift on the
 * trailing-12mo extrapolation.
 *
 * If the action's auth gate (requireContractScope) blocks the oracle's
 * unauthenticated call, the failure check explains that — a real
 * follow-up: the engine layer should be extractable for oracle / test
 * use without going through requireContractScope.
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"
import { getDemoFacilityId } from "./_shared/fixtures"

export default defineOracle("rebate-forecast", async (ctx) => {
  try {
    const facilityId = await getDemoFacilityId()

    // Find a contract at the demo facility with at least one tier and
    // some trailing spend history.
    const contract = await prisma.contract.findFirst({
      where: {
        facilityId,
        terms: { some: { tiers: { some: {} } } },
      },
      select: { id: true, name: true },
    })
    if (!contract) {
      ctx.check(
        "demo facility has a tiered contract for forecasting",
        false,
        "no Contract with terms+tiers at demo facility; run db:seed",
      )
      return
    }

    // ── Naive oracle baseline: trailing 12mo period spend ──────
    const since = new Date()
    since.setMonth(since.getMonth() - 12)
    const periods = await prisma.contractPeriod.findMany({
      where: { contractId: contract.id, periodEnd: { gte: since } },
      select: { totalSpend: true },
    })
    const trailingSpend = periods.reduce(
      (a, p) => a + Number(p.totalSpend ?? 0),
      0,
    )
    const oracleAvgMonthly = trailingSpend / 12
    const oracleForecastSpend = oracleAvgMonthly * 12

    // ── App ─────────────────────────────────────────────────────
    const { getRebateForecast } = await import(
      "@/lib/actions/analytics/rebate-forecast"
    )
    let forecast: Awaited<ReturnType<typeof getRebateForecast>> | null = null
    try {
      forecast = await getRebateForecast(contract.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.check(
        "getRebateForecast callable from oracle context",
        false,
        `${msg} — likely auth gate (requireContractScope); follow-up: extract the forecast engine to a non-action helper for oracle/test reuse`,
      )
      return
    }

    if (!forecast || !Array.isArray(forecast.forecast)) {
      ctx.check(
        "forecast result has a forecast array",
        false,
        `got: ${JSON.stringify(forecast).slice(0, 200)}`,
      )
      return
    }

    // ── Drift detection ─────────────────────────────────────────
    const appForecastSpendSum = forecast.forecast.reduce(
      (a, p) => a + Number(p.spend ?? 0),
      0,
    )
    const appForecastRebateSum = forecast.forecast.reduce(
      (a, p) => a + Number(p.rebateForPeriod ?? 0),
      0,
    )

    ctx.check(
      "forecast contains 12 monthly points",
      forecast.forecast.length === 12,
      `got ${forecast.forecast.length}`,
    )

    // The app's forecast may apply seasonality + growth on top of a
    // moving average; allow ±50% from the naive trailing extrapolation.
    // Outside that band suggests #82-class silent-zero or a runaway
    // scaling bug.
    const drift =
      oracleForecastSpend === 0
        ? appForecastSpendSum
        : Math.abs(appForecastSpendSum - oracleForecastSpend) /
          oracleForecastSpend
    ctx.check(
      "forecast spend sum within 50% of trailing-12mo extrapolation",
      drift <= 0.5 || (oracleForecastSpend === 0 && appForecastSpendSum === 0),
      `app=$${appForecastSpendSum.toFixed(0)} oracle=$${oracleForecastSpend.toFixed(0)} drift=${(drift * 100).toFixed(1)}%`,
    )

    // Catch the silent-zero class: any historical spend should produce
    // some forecast rebate.
    if (trailingSpend > 0) {
      ctx.check(
        "forecast rebate sum is non-zero when contract has spend",
        appForecastRebateSum > 0,
        `trailing-12mo spend=$${trailingSpend.toFixed(0)} but forecast rebate sum=$${appForecastRebateSum.toFixed(2)}`,
      )
    }

    // History should never be all-isForecast=true (we'd lose the
    // historical anchor).
    if (forecast.history.length > 0) {
      ctx.check(
        "history points are flagged isForecast=false",
        forecast.history.every((p) => !p.isForecast),
        `${forecast.history.filter((p) => p.isForecast).length} of ${forecast.history.length} history points wrongly flagged as forecast`,
      )
    }

    // Forecast points should all be flagged isForecast=true.
    ctx.check(
      "forecast points are flagged isForecast=true",
      forecast.forecast.every((p) => p.isForecast),
      `${forecast.forecast.filter((p) => !p.isForecast).length} of ${forecast.forecast.length} forecast points wrongly flagged as history`,
    )
  } finally {
    await prisma.$disconnect()
  }
})
