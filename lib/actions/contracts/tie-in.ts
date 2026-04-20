"use server"

/**
 * Tie-In bundle read for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
import {
  evaluateAllOrNothing,
  evaluateProportional,
  type TieInMember,
  type MemberPerformance,
} from "@/lib/contracts/tie-in"
import { buildTieInAmortizationSchedule } from "@/lib/rebates/engine/amortization"
import type { AmortizationEntry } from "@/lib/rebates/engine/types"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export async function getContractTieInBundle(contractId: string) {
  const { facility } = await requireFacility()

  const bundle = await prisma.tieInBundle.findUnique({
    where: { primaryContractId: contractId },
    include: {
      primaryContract: { select: { id: true, name: true, vendorId: true } },
      members: {
        include: {
          contract: {
            include: {
              vendor: { select: { id: true, name: true } },
              // Charles R5.29: include ALL terms, not just the first —
              // multi-term member contracts otherwise under-reported their
              // currentRebate inside tie-in bundles.
              terms: {
                include: { tiers: { orderBy: { tierNumber: "asc" } } },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  })

  if (!bundle) {
    return serialize({ bundle: null })
  }

  const perf: MemberPerformance[] = []
  for (const m of bundle.members) {
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: m.contract.vendorId,
      },
      _sum: { extendedPrice: true },
    })
    const spend = Number(cogAgg._sum.extendedPrice ?? 0)
    // Charles R5.29: sum rebate across every term with tiers. Tie-in
    // member contracts typically have one term, but nothing prevents
    // two — and when they do, both should contribute.
    let rebate = 0
    if (spend > 0) {
      for (const term of m.contract.terms) {
        if (term.tiers.length === 0) continue
        rebate += computeRebateFromPrismaTiers(spend, term.tiers, {
          method: term.rebateMethod ?? "cumulative",
        }).rebateEarned
      }
    }
    perf.push({
      contractId: m.contractId,
      currentSpend: spend,
      currentRebate: rebate,
    })
  }

  const members: TieInMember[] = bundle.members.map((m) => ({
    contractId: m.contractId,
    weightPercent: Number(m.weightPercent),
    minimumSpend: m.minimumSpend != null ? Number(m.minimumSpend) : null,
  }))

  const bonusMultiplier =
    bundle.bonusMultiplier != null ? Number(bundle.bonusMultiplier) : undefined

  const evaluation =
    bundle.complianceMode === "proportional"
      ? evaluateProportional(members, perf)
      : evaluateAllOrNothing(members, perf, { bonusMultiplier })

  const memberRows = bundle.members.map((m) => {
    const p = perf.find((p) => p.contractId === m.contractId)
    return {
      contractId: m.contractId,
      contractName: m.contract.name,
      vendorName: m.contract.vendor.name,
      weightPercent: Number(m.weightPercent),
      minimumSpend: m.minimumSpend != null ? Number(m.minimumSpend) : null,
      currentSpend: p?.currentSpend ?? 0,
      currentRebate: p?.currentRebate ?? 0,
      compliantSoFar:
        m.minimumSpend == null
          ? true
          : (p?.currentSpend ?? 0) >= Number(m.minimumSpend),
    }
  })

  return serialize({
    bundle: {
      id: bundle.id,
      complianceMode: bundle.complianceMode,
      bonusMultiplier: bundle.bonusMultiplier != null ? Number(bundle.bonusMultiplier) : null,
      members: memberRows,
      evaluation,
    },
  })
}

/**
 * ─── Wave A: tie-in capital schedule read ─────────────────────────
 *
 * Returns the full amortization schedule plus the three capital
 * summary numbers for a tie-in contract: remaining balance, principal
 * paid to date, and a linear-projection payoff date.
 *
 * The engine (lib/rebates/engine/amortization.ts) already builds the
 * schedule from capitalCost / interestRate / termMonths / cadence —
 * we just sequence it with the contract's effective date so we can
 * label rows with real dates and count how many periods have elapsed.
 *
 * If ContractAmortizationSchedule rows are persisted for the term we
 * prefer those (future writer paths will populate the table); if not,
 * we compute on the fly so the UI still renders something useful.
 *
 * Shape is fully serialized (Decimals → numbers, Dates → ISO strings)
 * so it crosses the server-action boundary cleanly.
 */

export interface ContractCapitalScheduleRow {
  periodNumber: number
  periodDate: string
  openingBalance: number
  interestCharge: number
  principalDue: number
  amortizationDue: number
  closingBalance: number
}

export interface ContractCapitalScheduleResult {
  /** null → this contract does not have a tie-in capital term yet. */
  hasSchedule: boolean
  capitalCost: number
  interestRate: number
  termMonths: number
  period: "monthly" | "quarterly" | "annual"
  schedule: ContractCapitalScheduleRow[]
  /** periodNumber of the last row whose periodDate ≤ today; 0 when none. */
  elapsedPeriods: number
  remainingBalance: number
  paidToDate: number
  /**
   * Projected capital balance at the contract's scheduled expiration
   * given the trailing-rebate paydown velocity. $0 means the paydown is
   * on track to retire the balance before the term ends. Charles (W1.E
   * follow-up) — medical tie-in contracts are locked to set term end
   * dates, so "projected payoff date" isn't meaningful; the useful
   * question is "will the balance be cleared BY the term end?"
   */
  projectedEndOfTermBalance: number | null
}

function normalizeCadence(
  raw: string | null | undefined,
): "monthly" | "quarterly" | "annual" {
  switch (raw) {
    case "monthly":
    case "quarterly":
    case "annual":
      return raw
    // paymentTiming uses "quarterly" as default; other values fall back.
    default:
      return "monthly"
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function monthsPerPeriod(p: "monthly" | "quarterly" | "annual"): number {
  switch (p) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "annual":
      return 12
  }
}

export async function getContractCapitalSchedule(
  contractId: string,
): Promise<ContractCapitalScheduleResult> {
  const { facility } = await requireFacility()

  // Charles W1.T — capital now lives on Contract; the amortization
  // schedule is keyed by contractId alone.
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: {
      id: true,
      effectiveDate: true,
      capitalCost: true,
      interestRate: true,
      termMonths: true,
      paymentCadence: true,
      amortizationShape: true,
      amortizationRows: {
        orderBy: { periodNumber: "asc" },
      },
    },
  })

  const empty: ContractCapitalScheduleResult = {
    hasSchedule: false,
    capitalCost: 0,
    interestRate: 0,
    termMonths: 0,
    period: "monthly",
    schedule: [],
    elapsedPeriods: 0,
    remainingBalance: 0,
    paidToDate: 0,
    projectedEndOfTermBalance: null,
  }

  if (
    !contract ||
    contract.capitalCost == null ||
    contract.interestRate == null ||
    contract.termMonths == null
  ) {
    return empty
  }

  const capitalCost = Number(contract.capitalCost)
  const interestRate = Number(contract.interestRate)
  const termMonths = Number(contract.termMonths)
  const period = normalizeCadence(contract.paymentCadence)

  if (capitalCost <= 0 || termMonths <= 0) return empty

  // Wave D — custom-shape contracts source rows from the persisted
  // table; symmetrical contracts always compute live so capital /
  // interest / term edits flow through without a write.
  let entries: AmortizationEntry[]
  if (
    contract.amortizationShape === "custom" &&
    contract.amortizationRows.length > 0
  ) {
    entries = contract.amortizationRows.map((r) => ({
      periodNumber: r.periodNumber,
      openingBalance: Number(r.openingBalance),
      interestCharge: Number(r.interestCharge),
      principalDue: Number(r.principalDue),
      amortizationDue: Number(r.amortizationDue),
      closingBalance: Number(r.closingBalance),
    }))
  } else {
    entries = buildTieInAmortizationSchedule({
      capitalCost,
      interestRate,
      termMonths,
      period,
    })
  }

  // Attach a period date to each row, anchored to contract.effectiveDate.
  const start = new Date(contract.effectiveDate)
  const monthsStep = monthsPerPeriod(period)
  const today = new Date()
  const schedule: ContractCapitalScheduleRow[] = entries.map((e) => {
    const periodDate = addMonths(start, e.periodNumber * monthsStep)
    return {
      periodNumber: e.periodNumber,
      periodDate: periodDate.toISOString(),
      openingBalance: e.openingBalance,
      interestCharge: e.interestCharge,
      principalDue: e.principalDue,
      amortizationDue: e.amortizationDue,
      closingBalance: e.closingBalance,
    }
  })

  // Elapsed = count rows whose periodDate ≤ today.
  const elapsedPeriods = schedule.filter(
    (r) => new Date(r.periodDate).getTime() <= today.getTime(),
  ).length

  const paidToDate = schedule
    .slice(0, elapsedPeriods)
    .reduce((acc, r) => acc + r.principalDue, 0)
  const remainingBalance = Math.max(0, capitalCost - paidToDate)

  // Projected end-of-term balance: how much capital remains at the
  // contract's scheduled expiration given trailing-90-day principal
  // velocity. Capped at 0 (paydown retires the balance early).
  let projectedEndOfTermBalance: number | null = null
  if (remainingBalance > 0 && elapsedPeriods > 0) {
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
    const trailing = schedule
      .slice(0, elapsedPeriods)
      .filter((r) => new Date(r.periodDate).getTime() >= ninetyDaysAgo.getTime())
    const windowPrincipal = trailing.length > 0
      ? trailing.reduce((a, r) => a + r.principalDue, 0)
      : // Fall back to the last elapsed row's per-period principal.
        schedule[elapsedPeriods - 1]!.principalDue
    const avgMonthlyPrincipal =
      trailing.length > 0
        ? windowPrincipal / (trailing.length * monthsStep)
        : windowPrincipal / monthsStep
    // Months between today and contract expiration — use the last
    // schedule row's periodDate as the scheduled term end (engine
    // already bounds the schedule by termMonths).
    const lastRow = schedule[schedule.length - 1]
    const termEndMs = lastRow
      ? new Date(lastRow.periodDate).getTime()
      : today.getTime()
    const monthsRemaining = Math.max(
      0,
      (termEndMs - today.getTime()) / (1000 * 60 * 60 * 24 * 30),
    )
    const projectedPaydown = avgMonthlyPrincipal * monthsRemaining
    projectedEndOfTermBalance = Math.max(0, remainingBalance - projectedPaydown)
  } else if (remainingBalance === 0) {
    projectedEndOfTermBalance = 0
  } else {
    // No elapsed periods yet — haven't accrued any rebate-paydown data,
    // so the best guess is that the full balance remains at term end.
    projectedEndOfTermBalance = remainingBalance
  }

  return {
    hasSchedule: true,
    capitalCost,
    interestRate,
    termMonths,
    period,
    schedule,
    elapsedPeriods,
    remainingBalance,
    paidToDate,
    projectedEndOfTermBalance,
  }
}

export interface ContractCapitalProjection {
  /** True when the contract has a tie-in capital term with capitalCost > 0. */
  hasProjection: boolean
  /** Dollars per month, from trailing-90-day rebate velocity. */
  monthlyPaydownRun: number
  /** null when monthlyPaydownRun ≤ 0. */
  projectedMonthsToPayoff: number | null
  /** Capped at 0; see paidOffBeforeTermEnd. */
  projectedEndOfTermBalance: number
  /** Months between today and contract.expirationDate, floored at 0. */
  termMonthsRemaining: number
  /** True when run-rate retires the balance before term end. */
  paidOffBeforeTermEnd: boolean
  /** Capital balance at the moment of projection. */
  remainingBalance: number
}

// Local helpers — duplicated from the schedule action intentionally so
// this file is self-contained and we don't churn Wave A's surface.
function normalizeCadenceLocal(
  raw: string | null | undefined,
): "monthly" | "quarterly" | "annual" {
  switch (raw) {
    case "monthly":
    case "quarterly":
    case "annual":
      return raw
    default:
      return "monthly"
  }
}

function addMonthsLocal(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function monthsPerPeriodLocal(
  p: "monthly" | "quarterly" | "annual",
): number {
  switch (p) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "annual":
      return 12
  }
}

export async function getContractCapitalProjection(
  contractId: string,
): Promise<ContractCapitalProjection> {
  const { facility } = await requireFacility()

  // Charles W1.T — capital read directly from Contract row.
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: {
      id: true,
      effectiveDate: true,
      expirationDate: true,
      capitalCost: true,
      interestRate: true,
      termMonths: true,
      paymentCadence: true,
    },
  })

  const empty: ContractCapitalProjection = {
    hasProjection: false,
    monthlyPaydownRun: 0,
    projectedMonthsToPayoff: null,
    projectedEndOfTermBalance: 0,
    termMonthsRemaining: 0,
    paidOffBeforeTermEnd: false,
    remainingBalance: 0,
  }

  if (
    !contract ||
    contract.capitalCost == null ||
    contract.interestRate == null ||
    contract.termMonths == null
  ) {
    return empty
  }
  const capitalCost = Number(contract.capitalCost)
  const interestRate = Number(contract.interestRate)
  const termMonths = Number(contract.termMonths)
  if (capitalCost <= 0 || termMonths <= 0) return empty

  const period = normalizeCadenceLocal(contract.paymentCadence)

  // Remaining balance — computed the same way as getContractCapitalSchedule
  // so the two surfaces never disagree.
  const entries = buildTieInAmortizationSchedule({
    capitalCost,
    interestRate,
    termMonths,
    period,
  })
  const start = new Date(contract.effectiveDate)
  const monthsStep = monthsPerPeriodLocal(period)
  const today = new Date()
  const scheduleDates = entries.map((e) => ({
    principalDue: e.principalDue,
    periodDate: addMonthsLocal(start, e.periodNumber * monthsStep),
  }))
  const elapsedPeriods = scheduleDates.filter(
    (r) => r.periodDate.getTime() <= today.getTime(),
  ).length
  const paidToDate = scheduleDates
    .slice(0, elapsedPeriods)
    .reduce((acc, r) => acc + r.principalDue, 0)
  const remainingBalance = Math.max(0, capitalCost - paidToDate)

  // Trailing 90-day rebate velocity.
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
  const rebateAgg = await prisma.rebate.aggregate({
    where: {
      contractId,
      facilityId: facility.id,
      payPeriodEnd: { gte: ninetyDaysAgo, lte: today },
    },
    _sum: { rebateEarned: true },
  })
  const trailing90Rebate = Number(rebateAgg._sum.rebateEarned ?? 0)
  // Spec: "divided by 90 * 30 for a monthly rate" — daily average × 30.
  const monthlyPaydownRun = (trailing90Rebate / 90) * 30

  const projectedMonthsToPayoff =
    monthlyPaydownRun > 0 && remainingBalance > 0
      ? Math.ceil(remainingBalance / monthlyPaydownRun)
      : null

  const expiration = contract.expirationDate
    ? new Date(contract.expirationDate)
    : null
  const termMonthsRemaining = expiration
    ? Math.max(
        0,
        (expiration.getTime() - today.getTime()) /
          (1000 * 60 * 60 * 24 * 30),
      )
    : 0

  const rawEndOfTerm =
    remainingBalance - monthlyPaydownRun * termMonthsRemaining
  const paidOffBeforeTermEnd = rawEndOfTerm <= 0 && remainingBalance > 0
  const projectedEndOfTermBalance = Math.max(0, rawEndOfTerm)

  return {
    hasProjection: true,
    monthlyPaydownRun,
    projectedMonthsToPayoff,
    projectedEndOfTermBalance,
    termMonthsRemaining,
    paidOffBeforeTermEnd,
    remainingBalance,
  }
}
