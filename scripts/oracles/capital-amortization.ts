// scripts/oracles/capital-amortization.ts
/**
 * Capital amortization oracle.
 *
 * Recomputes the standard PMT amortization for a ContractCapitalLineItem
 * and asserts the app's buildTieInAmortizationSchedule returns the same
 * schedule. Catches: PMT formula drift, principal/interest rounding
 * leaks, total-payment miscount, period-count off-by-one.
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"

type Cadence = "monthly" | "quarterly" | "annual"

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

/** Total period count rounded up: a 13-month term on quarterly cadence
 *  is 5 periods, not 4. Mirrors the engine. */
function totalPeriods(termMonths: number, cadence: Cadence): number {
  return Math.ceil(termMonths / monthsPerPeriod(cadence))
}

/** Standard PMT. Returns 0 when n=0. r=0 fallback collapses to P/n. */
function pmt(principal: number, periodicRate: number, n: number): number {
  if (n <= 0) return 0
  if (principal <= 0) return 0
  if (periodicRate === 0) return principal / n
  return (
    (principal * (periodicRate * Math.pow(1 + periodicRate, n))) /
    (Math.pow(1 + periodicRate, n) - 1)
  )
}

export default defineOracle("capital-amortization", async (ctx) => {
  try {
    // Pick any line item with a financed schedule.
    const item = await prisma.contractCapitalLineItem.findFirst({
      where: {
        contractTotal: { gt: 0 },
        termMonths: { gt: 0 },
      },
      select: {
        id: true,
        contractId: true,
        description: true,
        contractTotal: true,
        initialSales: true,
        interestRate: true,
        termMonths: true,
        paymentCadence: true,
      },
    })
    if (!item || item.termMonths == null) {
      ctx.check(
        "demo DB has a financed ContractCapitalLineItem to compare",
        false,
        "no ContractCapitalLineItem with contractTotal>0 and termMonths>0; run db:seed",
      )
      return
    }

    const cadenceRaw = (item.paymentCadence ?? "monthly").toLowerCase()
    const cadence: Cadence =
      cadenceRaw === "quarterly"
        ? "quarterly"
        : cadenceRaw === "annual" || cadenceRaw === "annually" || cadenceRaw === "yearly"
          ? "annual"
          : "monthly"

    const financed =
      Number(item.contractTotal ?? 0) - Number(item.initialSales ?? 0)
    const interestRate = Number(item.interestRate ?? 0)
    const n = totalPeriods(item.termMonths, cadence)
    const r = interestRate / periodsPerYear(cadence)

    // ── Independent oracle compute ──────────────────────────────
    const oraclePayment = pmt(financed, r, n)
    const oracleTotalPayments = oraclePayment * n
    const oracleTotalInterest = oracleTotalPayments - financed

    // ── App ─────────────────────────────────────────────────────
    const { buildTieInAmortizationSchedule } = await import(
      "@/lib/rebates/engine/amortization"
    )
    const schedule = buildTieInAmortizationSchedule({
      capitalCost: financed,
      interestRate,
      termMonths: item.termMonths,
      period: cadence,
    })

    if (schedule.length === 0) {
      ctx.check(
        "engine returned a non-empty schedule for a financed item",
        false,
        `financed=$${financed.toFixed(2)} rate=${interestRate} term=${item.termMonths}mo cadence=${cadence}`,
      )
      return
    }

    const appPayment = schedule[0]?.amortizationDue ?? 0
    const appTotalPayments = schedule.reduce((a, p) => a + p.amortizationDue, 0)
    const appTotalInterest = schedule.reduce((a, p) => a + p.interestCharge, 0)
    const appTotalPrincipal = schedule.reduce((a, p) => a + p.principalDue, 0)

    // ── Compare ─────────────────────────────────────────────────
    ctx.check(
      "schedule has the right number of periods",
      schedule.length === n,
      `app=${schedule.length} oracle=${n} (term=${item.termMonths}mo cadence=${cadence})`,
    )
    ctx.check(
      "periodic payment matches PMT formula (±$0.01)",
      Math.abs(appPayment - oraclePayment) < 0.01,
      `app=$${appPayment.toFixed(2)} oracle=$${oraclePayment.toFixed(2)} (financed=$${financed.toFixed(2)} rate=${interestRate} n=${n})`,
    )
    ctx.check(
      "total payments equal payment × n (±$0.05)",
      Math.abs(appTotalPayments - oracleTotalPayments) < 0.05,
      `app=$${appTotalPayments.toFixed(2)} oracle=$${oracleTotalPayments.toFixed(2)}`,
    )
    ctx.check(
      "principal sum equals financed amount (±$0.05)",
      Math.abs(appTotalPrincipal - financed) < 0.05,
      `app=$${appTotalPrincipal.toFixed(2)} financed=$${financed.toFixed(2)}`,
    )
    ctx.check(
      "principal + interest = total payments (no rounding leak, ±$0.01)",
      Math.abs(appTotalPrincipal + appTotalInterest - appTotalPayments) < 0.01,
      `principal=$${appTotalPrincipal.toFixed(2)} interest=$${appTotalInterest.toFixed(2)} total=$${appTotalPayments.toFixed(2)}`,
    )
    ctx.check(
      "interest sum matches oracle (±$0.05)",
      Math.abs(appTotalInterest - oracleTotalInterest) < 0.05,
      `app=$${appTotalInterest.toFixed(2)} oracle=$${oracleTotalInterest.toFixed(2)}`,
    )
  } finally {
    await prisma.$disconnect()
  }
})
