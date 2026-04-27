// scripts/oracles/capital-amortization.ts
/**
 * Capital amortization oracle.
 *
 * Mock-driven: builds synthetic LeasedServiceItem-shaped inputs in
 * memory and asserts the app's `buildTieInAmortizationSchedule` engine
 * returns the same schedule the standard PMT formula does. No DB
 * dependency — runs deterministically on any machine, doesn't need
 * `bun run db:seed`. Catches: PMT formula drift, principal/interest
 * rounding leaks, total-payment miscount, period-count off-by-one.
 *
 * Mock fixtures cover the cases that historically break first:
 *   - non-zero rate, monthly cadence (the common case)
 *   - non-zero rate, quarterly cadence (period-count off-by-one risk)
 *   - zero rate (PMT collapses to P/n)
 *   - non-integer term-in-cadence (13mo on quarterly = 5 periods)
 */
import { defineOracle } from "./_shared/runner"

type Cadence = "monthly" | "quarterly" | "annual"

interface MockLineItem {
  label: string
  contractTotal: number
  initialSales: number
  interestRate: number
  termMonths: number
  paymentCadence: Cadence
}

const FIXTURES: MockLineItem[] = [
  {
    label: "monthly 60mo @ 5%",
    contractTotal: 1_200_000,
    initialSales: 200_000,
    interestRate: 0.05,
    termMonths: 60,
    paymentCadence: "monthly",
  },
  {
    label: "quarterly 36mo @ 4.5%",
    contractTotal: 600_000,
    initialSales: 100_000,
    interestRate: 0.045,
    termMonths: 36,
    paymentCadence: "quarterly",
  },
  {
    label: "monthly 24mo @ 0% (zero-rate edge case)",
    contractTotal: 100_000,
    initialSales: 0,
    interestRate: 0,
    termMonths: 24,
    paymentCadence: "monthly",
  },
  {
    label: "quarterly 13mo @ 6% (non-integer cadence — round-up to 5 periods)",
    contractTotal: 250_000,
    initialSales: 50_000,
    interestRate: 0.06,
    termMonths: 13,
    paymentCadence: "quarterly",
  },
]

function monthsPerPeriod(c: Cadence): number {
  switch (c) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "annual":
      return 12
  }
}

function periodsPerYear(c: Cadence): number {
  switch (c) {
    case "monthly":
      return 12
    case "quarterly":
      return 4
    case "annual":
      return 1
  }
}

/** Total period count rounded up (mirrors the engine). */
function totalPeriods(termMonths: number, cadence: Cadence): number {
  return Math.ceil(termMonths / monthsPerPeriod(cadence))
}

/** Standard PMT. r=0 fallback collapses to P/n. */
function pmt(principal: number, periodicRate: number, n: number): number {
  if (n <= 0 || principal <= 0) return 0
  if (periodicRate === 0) return principal / n
  return (
    (principal * (periodicRate * Math.pow(1 + periodicRate, n))) /
    (Math.pow(1 + periodicRate, n) - 1)
  )
}

export default defineOracle("capital-amortization", async (ctx) => {
  const { buildTieInAmortizationSchedule } = await import(
    "@/lib/rebates/engine/amortization"
  )

  for (const item of FIXTURES) {
    const financed = item.contractTotal - item.initialSales
    const n = totalPeriods(item.termMonths, item.paymentCadence)
    const r = item.interestRate / periodsPerYear(item.paymentCadence)

    // ── Oracle compute ──────────────────────────────────────────
    const oraclePayment = pmt(financed, r, n)
    const oracleTotalPayments = oraclePayment * n
    const oracleTotalInterest = oracleTotalPayments - financed

    // ── App engine ──────────────────────────────────────────────
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: financed,
      interestRate: item.interestRate,
      termMonths: item.termMonths,
      period: item.paymentCadence,
    })

    if (schedule.length === 0) {
      ctx.check(
        `[${item.label}] engine returned a non-empty schedule`,
        false,
        `financed=$${financed.toFixed(2)} rate=${item.interestRate} term=${item.termMonths}mo`,
      )
      continue
    }

    const appPayment = schedule[0].amortizationDue
    const appTotalPayments = schedule.reduce((a, p) => a + p.amortizationDue, 0)
    const appTotalInterest = schedule.reduce((a, p) => a + p.interestCharge, 0)
    const appTotalPrincipal = schedule.reduce((a, p) => a + p.principalDue, 0)

    ctx.check(
      `[${item.label}] period count == ceil(term/cadence)`,
      schedule.length === n,
      `app=${schedule.length} oracle=${n}`,
    )
    ctx.check(
      `[${item.label}] periodic payment matches PMT (±$0.01)`,
      Math.abs(appPayment - oraclePayment) < 0.01,
      `app=$${appPayment.toFixed(2)} oracle=$${oraclePayment.toFixed(2)}`,
    )
    ctx.check(
      `[${item.label}] total payments == payment × n (±$0.05)`,
      Math.abs(appTotalPayments - oracleTotalPayments) < 0.05,
      `app=$${appTotalPayments.toFixed(2)} oracle=$${oracleTotalPayments.toFixed(2)}`,
    )
    ctx.check(
      `[${item.label}] principal sum == financed (±$0.05)`,
      Math.abs(appTotalPrincipal - financed) < 0.05,
      `app=$${appTotalPrincipal.toFixed(2)} financed=$${financed.toFixed(2)}`,
    )
    ctx.check(
      `[${item.label}] principal + interest == total (±$0.01)`,
      Math.abs(appTotalPrincipal + appTotalInterest - appTotalPayments) < 0.01,
      `principal=$${appTotalPrincipal.toFixed(2)} interest=$${appTotalInterest.toFixed(2)} total=$${appTotalPayments.toFixed(2)}`,
    )
    ctx.check(
      `[${item.label}] interest sum matches oracle (±$0.05)`,
      Math.abs(appTotalInterest - oracleTotalInterest) < 0.05,
      `app=$${appTotalInterest.toFixed(2)} oracle=$${oracleTotalInterest.toFixed(2)}`,
    )
  }
})
