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
import { sumRebateAppliedToCapital } from "@/lib/contracts/rebate-capital-filter"
import type { CollectedRebateLike } from "@/lib/contracts/rebate-collected-filter"

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
    // Cross-vendor members (contractId null) are NOT supported by this
    // legacy read path yet — it was written before the cross-vendor
    // schema change. Skip them so existing pre-cross-vendor bundles
    // keep working; cross-vendor bundles should be consumed via
    // `computeBundleStatus` in `lib/contracts/bundle-compute.ts`.
    if (!m.contract || !m.contractId) continue
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: m.contract.vendorId,
      },
      _sum: { extendedPrice: true },
    })
    const spend = Number(cogAgg._sum.extendedPrice ?? 0)
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

  const members: TieInMember[] = bundle.members
    .filter((m): m is typeof m & { contractId: string } => m.contractId !== null)
    .map((m) => ({
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

  const memberRows = bundle.members
    .filter((m): m is typeof m & { contract: NonNullable<typeof m.contract> } => m.contract !== null)
    .map((m) => {
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
  /**
   * Charles 2026-04-25 (Bug 23): collected rebate that landed inside this
   * period's window (collectionDate falls between the previous row's
   * periodDate and this row's periodDate, inclusive of the upper bound).
   * Only populated for tie-in contracts where rebate retires capital;
   * 0 for non-tie-in. Sums across rows equal `rebateAppliedToCapital`.
   */
  rebateAppliedThisPeriod: number
}

export interface ContractCapitalScheduleResult {
  /** null → this contract does not have a tie-in capital term yet. */
  hasSchedule: boolean
  capitalCost: number
  /** Charles audit pass-4: cash put down at signing. */
  downPayment: number
  /** Charles audit pass-4: capitalCost − downPayment, what the schedule actually amortizes. */
  financedPrincipal: number
  interestRate: number
  termMonths: number
  period: "monthly" | "quarterly" | "annual"
  schedule: ContractCapitalScheduleRow[]
  /** periodNumber of the last row whose periodDate ≤ today; 0 when none. */
  elapsedPeriods: number
  remainingBalance: number
  /**
   * Capital paid down to date.
   *
   * Charles W1.Y-C (C2): on tie-in contracts, "Paid to Date" is the sum
   * of collected rebate (`sumRebateAppliedToCapital`) — not the sum of
   * scheduled `principalDue` across elapsed periods. The schedule is a
   * forecast, not a ledger; collected rebate is the only actual paydown.
   * For non-tie-in contracts this is 0.
   */
  paidToDate: number
  /**
   * Sum of collected rebate that has been applied to the capital balance
   * (Charles W1.Y-C). Equal to `paidToDate` on tie-in contracts; surfaced
   * separately so the UI can label the number unambiguously (tie-in
   * capital retires via rebate, not cash).
   */
  rebateAppliedToCapital: number
  /**
   * Projected capital balance at the contract's scheduled expiration
   * given the trailing-rebate paydown velocity. $0 means the paydown is
   * on track to retire the balance before the term ends. Charles (W1.E
   * follow-up) — medical tie-in contracts are locked to set term end
   * dates, so "projected payoff date" isn't meaningful; the useful
   * question is "will the balance be cleared BY the term end?"
   */
  projectedEndOfTermBalance: number | null
  /** Charles W1.Y-D — contract type, so the card can conditionally render
   * the tie-in-only Minimum Annual Purchase + retirement block. */
  contractType: string
  /** Charles W1.Y-D — minimum annual purchase floor, sourced from the
   * largest `minimumPurchaseCommitment` across the contract's terms (the
   * tie-in term typically carries this). Null when no term has one. */
  minAnnualPurchase: number | null
  /** Charles W1.Y-D — trailing-12mo spend, computed via the same cascade
   * as `getContract` (ContractPeriod → COG contract-scoped → COG
   * vendor-scoped). Feeds `computeMinAnnualShortfall`. */
  rolling12Spend: number
  /** Charles W1.Y-D — current tier rate as integer percent (5 = 5%),
   * derived from the contract's first tiered term at `rolling12Spend`.
   * Zero when no tiered term / tiers exist. */
  currentTierPercent: number
  /** Charles W1.Y-D — remaining periods on the amortization schedule
   * (total − elapsed) expressed in MONTHS. Feeds
   * `computeCapitalRetirementNeeded`. */
  monthsRemaining: number
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
  // Charles W1.Y-C — also pull contractType + rebates so we can route
  // "Paid to Date" through the canonical `sumRebateAppliedToCapital`
  // helper instead of the forecast `principalDue` sum.
  // Charles W1.Y-D — also pull vendorId + terms/tiers +
  // `minimumPurchaseCommitment` so the card can render the tie-in-only
  // Minimum Annual Purchase shortfall + "Annual Spend Needed to Retire
  // Capital" block at the current tier rate.
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: {
      id: true,
      contractType: true,
      vendorId: true,
      effectiveDate: true,
      capitalCost: true,
      downPayment: true,
      facilityId: true,
      interestRate: true,
      termMonths: true,
      paymentCadence: true,
      amortizationShape: true,
      amortizationRows: {
        orderBy: { periodNumber: "asc" },
      },
      rebates: {
        select: {
          collectionDate: true,
          rebateCollected: true,
        },
      },
      terms: {
        select: {
          minimumPurchaseCommitment: true,
          spendBaseline: true,
          rebateMethod: true,
          tiers: {
            select: {
              tierNumber: true,
              spendMin: true,
              spendMax: true,
              rebateValue: true,
              rebateType: true,
            },
            orderBy: { tierNumber: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  const empty: ContractCapitalScheduleResult = {
    hasSchedule: false,
    capitalCost: 0,
    downPayment: 0,
    financedPrincipal: 0,
    interestRate: 0,
    termMonths: 0,
    period: "monthly",
    schedule: [],
    elapsedPeriods: 0,
    remainingBalance: 0,
    paidToDate: 0,
    rebateAppliedToCapital: 0,
    projectedEndOfTermBalance: null,
    contractType: contract?.contractType ?? "usage",
    minAnnualPurchase: null,
    rolling12Spend: 0,
    currentTierPercent: 0,
    monthsRemaining: 0,
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
  const downPayment = Number(contract.downPayment ?? 0)
  // Charles audit pass-4 BLOCKER 1: amortize the financed principal
  // (capitalCost - downPayment), not the gross sticker. Earlier code
  // passed capitalCost straight in, overstating PMT/interest/balance
  // by (capitalCost / financed) ratio. Clamp at 0 to handle the edge
  // case downPayment > capitalCost.
  const financedPrincipal = Math.max(0, capitalCost - downPayment)
  const interestRate = Number(contract.interestRate)
  const termMonths = Number(contract.termMonths)
  const period = normalizeCadence(contract.paymentCadence)

  if (financedPrincipal <= 0 || termMonths <= 0) return empty

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
      capitalCost: financedPrincipal,
      interestRate,
      termMonths,
      period,
    })
  }

  // Attach a period date to each row, anchored to contract.effectiveDate.
  const start = new Date(contract.effectiveDate)
  const monthsStep = monthsPerPeriod(period)
  const today = new Date()
  // Charles 2026-04-25 (Bug 23): bucket collected rebates into amortization
  // periods so the schedule can show how much rebate paid down capital
  // each period. Two models supported:
  //   (a) Single-row "tie_in" contract — its own collected rebates
  //       retire its own capital.
  //   (b) Separate-row "capital" contract — sibling usage contracts
  //       carrying `tieInCapitalContractId === this.id` contribute
  //       their collected rebates to retire this capital balance.
  // Charles audit pass-4 CONCERN 6: previously only (a) was handled;
  // any usage contract pointing at a separate capital row had its
  // capital silently un-paydown.
  const isTieIn = contract.contractType === "tie_in"
  const isCapital = contract.contractType === "capital"
  const collectionsByPeriod = new Map<number, number>()
  // Aggregate own + sibling rebates so we walk one combined list.
  const allRebates: CollectedRebateLike[] = isTieIn
    ? [...contract.rebates]
    : []
  if (isCapital) {
    const siblingRebates = await prisma.rebate.findMany({
      where: {
        contract: {
          tieInCapitalContractId: contract.id,
          facilityId: contract.facilityId,
        },
      },
      select: { collectionDate: true, rebateCollected: true },
    })
    allRebates.push(...siblingRebates)
  }
  if (isTieIn || isCapital) {
    for (const r of allRebates) {
      if (!r.collectionDate) continue
      const collectedMs = new Date(r.collectionDate).getTime()
      const startMs = start.getTime()
      if (collectedMs < startMs) continue
      const monthsSinceStart =
        (collectedMs - startMs) / (1000 * 60 * 60 * 24 * 30.4375)
      const periodNumber = Math.max(
        1,
        Math.min(entries.length, Math.ceil(monthsSinceStart / monthsStep)),
      )
      const prior = collectionsByPeriod.get(periodNumber) ?? 0
      collectionsByPeriod.set(
        periodNumber,
        prior + Number(r.rebateCollected ?? 0),
      )
    }
  }
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
      rebateAppliedThisPeriod: collectionsByPeriod.get(e.periodNumber) ?? 0,
    }
  })

  // Elapsed = count rows whose periodDate ≤ today.
  const elapsedPeriods = schedule.filter(
    (r) => new Date(r.periodDate).getTime() <= today.getTime(),
  ).length

  // Charles W1.Y-C (C2): "Paid to Date" is the sum of collected rebate
  // applied to capital, not the schedule's elapsed `principalDue`. The
  // schedule is a forecast; collected rebate is the actual paydown.
  // Route through the canonical `sumRebateAppliedToCapital` so the
  // amortization card, the contract-detail header sublabel, and any
  // future tie-in dashboard agree on one number. Non-tie-in contracts
  // return 0 (no capital to retire via rebate).
  // Use the combined own+sibling rebate list so a separate-row
  // capital contract's paydown reflects all usage contracts pointing
  // at it.
  const rebateAppliedToCapital = sumRebateAppliedToCapital(
    allRebates,
    isCapital ? "tie_in" : contract.contractType,
  )
  const paidToDate = rebateAppliedToCapital
  const remainingBalance = Math.max(0, financedPrincipal - paidToDate)

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

  // Charles W1.Y-D — enrichments used by the amortization card to render
  // the tie-in Minimum Annual Purchase + "Annual Spend Needed to Retire
  // Capital" block. These are derived here so the card stays a thin
  // renderer and the math lives alongside the schedule read.

  // minAnnualPurchase: largest explicit `minimumPurchaseCommitment` across
  // terms. If no term carries one, fall back to the largest `spendBaseline`
  // across terms — user note 2026-04-23: "That is technically the
  // definition of the Baseline that is in the Term/Tiers for a rebate."
  // A tie-in contract's capital term typically carries
  // `minimumPurchaseCommitment`; picking the max avoids surfacing a second
  // term's smaller per-term commitment. The baseline fallback means a
  // contract that defined its spend commitment at the term-level Baseline
  // field still drives the Min Annual Purchase card instead of showing `—`.
  let minAnnualPurchase: number | null = null
  for (const t of contract.terms) {
    if (t.minimumPurchaseCommitment == null) continue
    const n = Number(t.minimumPurchaseCommitment)
    if (!Number.isFinite(n) || n <= 0) continue
    if (minAnnualPurchase == null || n > minAnnualPurchase) {
      minAnnualPurchase = n
    }
  }
  if (minAnnualPurchase == null) {
    for (const t of contract.terms) {
      if (t.spendBaseline == null) continue
      const n = Number(t.spendBaseline)
      if (!Number.isFinite(n) || n <= 0) continue
      if (minAnnualPurchase == null || n > minAnnualPurchase) {
        minAnnualPurchase = n
      }
    }
  }

  // Rolling-12 spend cascade (mirrors `getContract` in lib/actions/
  // contracts.ts so the card agrees with the detail header).
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd)
  windowStart.setFullYear(windowStart.getFullYear() - 1)
  const [cogAgg, cogVendorAgg, periodAgg] = await Promise.all([
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        contractId: contract.id,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.contractPeriod.aggregate({
      where: {
        contractId: contract.id,
        periodStart: { gte: windowStart },
        periodEnd: { lte: windowEnd },
      },
      _sum: { totalSpend: true },
    }),
  ])
  const cogSpend = Number(cogAgg._sum.extendedPrice ?? 0)
  const cogVendorSpend = Number(cogVendorAgg._sum.extendedPrice ?? 0)
  const periodSpend = Number(periodAgg._sum.totalSpend ?? 0)
  const rolling12Spend =
    periodSpend > 0 ? periodSpend : cogSpend > 0 ? cogSpend : cogVendorSpend

  // Current tier percent: first term with tiers, evaluated at rolling-12
  // spend. `computeRebateFromPrismaTiers` handles the FRACTION→INTEGER
  // percent scaling (see rebate-units note in calculate.ts).
  let currentTierPercent = 0
  for (const t of contract.terms) {
    if (t.tiers.length === 0) continue
    const { rebatePercent } = computeRebateFromPrismaTiers(
      rolling12Spend,
      t.tiers,
      { method: t.rebateMethod ?? "cumulative" },
    )
    currentTierPercent = rebatePercent
    break
  }

  // Months remaining: unelapsed periods × months/period.
  const monthsRemaining = Math.max(
    0,
    (schedule.length - elapsedPeriods) * monthsStep,
  )

  return {
    hasSchedule: true,
    capitalCost,
    // Charles audit pass-4: expose financed principal + downPayment so
    // surfaces like TieInRebateSplit can compute the cash-vs-capital
    // split honestly.
    downPayment,
    financedPrincipal,
    interestRate,
    termMonths,
    period,
    schedule,
    elapsedPeriods,
    remainingBalance,
    paidToDate,
    rebateAppliedToCapital,
    projectedEndOfTermBalance,
    contractType: contract.contractType,
    minAnnualPurchase,
    rolling12Spend,
    currentTierPercent,
    monthsRemaining,
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
  // Charles iMessage 2026-04-20 math audit: also pull contractType +
  // rebates so the projection's `remainingBalance` can route through
  // the canonical `sumRebateAppliedToCapital` helper — matching what
  // getContractCapitalSchedule does. Previously this function computed
  // paidToDate as a forecast sum of elapsed `principalDue` rows, which
  // under-estimated remainingBalance for brand-new contracts and
  // produced artificially-short projectedMonthsToPayoff on the Capital
  // Payoff Projection card.
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: {
      id: true,
      contractType: true,
      effectiveDate: true,
      expirationDate: true,
      capitalCost: true,
      downPayment: true,
      facilityId: true,
      interestRate: true,
      termMonths: true,
      paymentCadence: true,
      rebates: {
        select: {
          collectionDate: true,
          rebateCollected: true,
        },
      },
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
  const downPayment = Number(contract.downPayment ?? 0)
  // Charles audit pass-4 BLOCKER 1: amortize financed principal.
  const financedPrincipal = Math.max(0, capitalCost - downPayment)
  const interestRate = Number(contract.interestRate)
  const termMonths = Number(contract.termMonths)
  if (financedPrincipal <= 0 || termMonths <= 0) return empty

  const period = normalizeCadenceLocal(contract.paymentCadence)

  // Remaining balance — computed the same way as getContractCapitalSchedule
  // so the two surfaces never disagree.
  const entries = buildTieInAmortizationSchedule({
    capitalCost: financedPrincipal,
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
  // Charles iMessage 2026-04-20 math audit: paidToDate routes through
  // the canonical `sumRebateAppliedToCapital` so this projection agrees
  // with `getContractCapitalSchedule`. Legacy behavior summed elapsed
  // `principalDue` (forecast), which was inconsistent with the
  // user-facing amortization card.
  // Charles audit pass-4 CONCERN 6: aggregate sibling-usage rebates
  // when this is a separate-row capital contract.
  const isCapitalRow = contract.contractType === "capital"
  let allRebates: CollectedRebateLike[] =
    contract.contractType === "tie_in" ? [...contract.rebates] : []
  if (isCapitalRow) {
    const sib = await prisma.rebate.findMany({
      where: {
        contract: {
          tieInCapitalContractId: contract.id,
          facilityId: facility.id,
        },
      },
      select: { collectionDate: true, rebateCollected: true },
    })
    allRebates = sib
  }
  const paidToDate = sumRebateAppliedToCapital(
    allRebates,
    isCapitalRow ? "tie_in" : contract.contractType,
  )
  const remainingBalance = Math.max(0, financedPrincipal - paidToDate)

  // Trailing 90-day rebate velocity. For separate-row capital
  // contracts, sum across sibling usage contracts pointing at this
  // capital row instead of contractId-only.
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
  const rebateAgg = await prisma.rebate.aggregate({
    where: isCapitalRow
      ? {
          contract: {
            tieInCapitalContractId: contractId,
            facilityId: facility.id,
          },
          payPeriodEnd: { gte: ninetyDaysAgo, lte: today },
        }
      : {
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
