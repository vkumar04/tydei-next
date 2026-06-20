"use server"

/**
 * Tie-In bundle read for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 */
import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
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
import { selectMinAnnualPurchase } from "@/lib/contracts/min-annual-selection"
import type { CollectedRebateLike } from "@/lib/contracts/rebate-collected-filter"
import {
  normalizeCapitalLineItems,
  sumCapitalCost,
  sumFinancedPrincipal,
  sumInitialSales,
  type NormalizedCapitalLineItem,
} from "@/lib/contracts/capital-line-items"

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
  period: "monthly" | "quarterly" | "semi_annual" | "annual"
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
   * (Charles W1.Y-C). Surfaced separately so the UI can label the number
   * unambiguously (tie-in capital retires via rebate, not cash).
   */
  rebateAppliedToCapital: number
  /**
   * Sum of user-logged payments/credits applied to the capital balance
   * (Charles 2026-06-20: "payments and credits are how things are paid
   * off"). These are the `Log Credit / Payment` entries — on a pure capital
   * contract (no rebates) this is the ONLY paydown. Part of `paidToDate`.
   */
  paymentsAppliedToCapital: number
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
  /** Charles W1.Y-D — minimum annual purchase floor. E4 (Charles
   * 2026-06-06): now the LOWEST positive `minimumPurchaseCommitment` across
   * the contract's terms (was largest), falling back to the lowest positive
   * `spendBaseline`. Null when no term has either. */
  minAnnualPurchase: number | null
  /** E4 (Charles 2026-06-06) — where `minAnnualPurchase` came from, so the
   * card can disclose the choice. Null when there's no floor at all. */
  minAnnualPurchaseSource: "commitment" | "baseline" | null
  /** E4 (Charles 2026-06-06) — count of terms carrying a positive
   * `minimumPurchaseCommitment`; lets the UI say "lowest of N". 0 when the
   * floor came from a baseline fallback or there's no floor. */
  minAnnualPurchaseCommitmentCount: number
  /** E3 (Charles 2026-06-06) — forward-looking pace toward the floor at the
   * current rolling-12 run rate. Null when there's no floor. */
  minAnnualPace: {
    projectedAnnualSpend: number
    onPaceToMeet: boolean
    monthlySpendNeeded: number
  } | null
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
  /**
   * Charles audit suggestion #4 (v0-port): per-asset capital line
   * items. v0's tie-in card renders one row per leased item. When
   * there are no real line items, this contains the synthesized
   * single item from the legacy contract-level fields (isLegacy=true).
   */
  capitalLineItems: NormalizedCapitalLineItem[]
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

/**
 * Charles audit suggestion #4 (v0-port): aggregate per-item
 * amortization schedules into a combined view. Each line item
 * amortizes independently (its own financedPrincipal × interestRate
 * × termMonths × cadence) and the rows are summed period-by-period.
 *
 * Items with different cadences are first projected onto the longest
 * cadence's grid (e.g. quarterly + monthly → monthly grid; quarterly
 * payments land on every 3rd month). Items with different term
 * lengths produce zero rows past their own end (the longest term
 * defines schedule length).
 */
type Cadence = "monthly" | "quarterly" | "semi_annual" | "annual"

const CADENCES: readonly string[] = ["monthly", "quarterly", "semi_annual", "annual"]
/** Coerce a contract's rebatePayPeriod (PerformancePeriod enum) to a Cadence. */
function toCadence(s: string | null | undefined): Cadence | undefined {
  return s && CADENCES.includes(s) ? (s as Cadence) : undefined
}

function aggregatePerItemSchedules(
  items: ReadonlyArray<NormalizedCapitalLineItem>,
  // Bug 3: when set, every item amortizes on this cadence instead of its
  // own stored paymentCadence — used to make the schedule follow the
  // contract's rebatePayPeriod.
  cadenceOverride?: Cadence,
): { entries: AmortizationEntry[]; period: Cadence } {
  if (items.length === 0) return { entries: [], period: "monthly" }
  // Bug #11 defense-in-depth: if every item has zero financed principal
  // (e.g. user set Initial Sales == Contract Total), there's nothing to
  // amortize — return empty so the UI surfaces the "no schedule" empty
  // state instead of N rows full of $0 columns. The parent
  // `getContractCapitalSchedule` already short-circuits via
  // `financedPrincipal <= 0` but this guards aggregator-callers too.
  const totalFinanced = items.reduce(
    (acc, i) => acc + Math.max(0, i.contractTotal - i.initialSales),
    0,
  )
  if (totalFinanced <= 0) return { entries: [], period: "monthly" }

  // Find the finest cadence (smallest months-per-period) so we render
  // on the densest possible grid — unless the caller overrides it.
  const cadences = new Set(items.map((i) => i.paymentCadence))
  const period: Cadence =
    cadenceOverride ??
    (cadences.has("monthly")
      ? "monthly"
      : cadences.has("quarterly")
        ? "quarterly"
        : cadences.has("semi_annual")
          ? "semi_annual"
          : "annual")
  const stepMonths = monthsPerPeriod(period)

  // Build each item's schedule on its own cadence, then map onto the
  // combined cadence's period numbers.
  const totalMonths = Math.max(...items.map((i) => i.termMonths))
  const totalPeriods = Math.ceil(totalMonths / stepMonths)
  const combined = Array.from({ length: totalPeriods }, (_, i) => ({
    periodNumber: i + 1,
    openingBalance: 0,
    interestCharge: 0,
    principalDue: 0,
    amortizationDue: 0,
    closingBalance: 0,
  }))

  for (const item of items) {
    const itemFinanced = Math.max(0, item.contractTotal - item.initialSales)
    if (itemFinanced <= 0 || item.termMonths <= 0) continue
    const itemCadence = cadenceOverride ?? item.paymentCadence
    const sched = buildTieInAmortizationSchedule({
      capitalCost: itemFinanced,
      interestRate: item.interestRate,
      termMonths: item.termMonths,
      period: itemCadence,
    })
    const itemStep = monthsPerPeriod(itemCadence)
    // Charles audit final: project the per-item schedule onto the
    // combined grid, carrying balances forward in non-payment periods
    // so the running-balance display stays smooth instead of
    // sawtoothing on quarterly-on-monthly grids. The item's payment
    // (interest + principal + amortizationDue) only lands in the
    // period its payment is actually due; openingBalance and
    // closingBalance carry the item's outstanding principal across
    // every period.
    let lastClosing = itemFinanced
    let scheduleIdx = 0
    for (let p = 0; p < combined.length; p++) {
      const monthsAtEndOfPeriod = (p + 1) * stepMonths
      // Walk the per-item schedule rows whose due-date falls within
      // this combined period.
      const target = combined[p]
      target.openingBalance += lastClosing
      while (
        scheduleIdx < sched.length &&
        sched[scheduleIdx].periodNumber * itemStep <= monthsAtEndOfPeriod
      ) {
        const row = sched[scheduleIdx]
        target.interestCharge += row.interestCharge
        target.principalDue += row.principalDue
        target.amortizationDue += row.amortizationDue
        lastClosing = row.closingBalance
        scheduleIdx += 1
      }
      target.closingBalance += lastClosing
    }
  }

  return { entries: combined, period }
}

function monthsPerPeriod(p: "monthly" | "quarterly" | "semi_annual" | "annual"): number {
  switch (p) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "semi_annual":
      return 6
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
      facilityId: true,
      amortizationShape: true,
      // Bug 3/4 (Vick): the capital amortization cadence follows the
      // contract's cadence, not the per-line-item default ("monthly").
      // The user sets it via the "Performance Period" field
      // (performancePeriod) — #39 keyed off rebatePayPeriod by mistake, so
      // a semi-annual contract still rendered monthly. Prefer
      // performancePeriod, fall back to rebatePayPeriod, then line items.
      performancePeriod: true,
      rebatePayPeriod: true,
      amortizationRows: {
        orderBy: { periodNumber: "asc" },
      },
      // Charles audit suggestion #4 (v0-port): per-asset capital line
      // items. When present, these override the contract-level
      // capitalCost/etc. for schedule aggregation.
      capitalLineItems: { orderBy: { createdAt: "asc" } },
      name: true,
      rebates: {
        select: {
          collectionDate: true,
          rebateCollected: true,
        },
      },
      terms: {
        select: {
          termType: true,
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
    paymentsAppliedToCapital: 0,
    projectedEndOfTermBalance: null,
    contractType: contract?.contractType ?? "usage",
    minAnnualPurchase: null,
    minAnnualPurchaseSource: null,
    minAnnualPurchaseCommitmentCount: 0,
    minAnnualPace: null,
    rolling12Spend: 0,
    currentTierPercent: 0,
    monthsRemaining: 0,
    capitalLineItems: [],
  }

  if (!contract) return empty

  // Charles audit suggestion #4 (v0-port): capital lives in line items.
  // No items → no schedule. Each item carries its own rate / term /
  // cadence; the aggregation below sums per-item PMTs.
  const lineItems = normalizeCapitalLineItems(contract)
  if (lineItems.length === 0) return empty

  // Cadence source of truth = the per-line-item `paymentCadence` (the capital
  // editor writes it). `contract.performancePeriod` is NON-NULL and defaults to
  // "monthly", so the old performancePeriod-first logic silently forced every
  // line item to monthly — a quarterly / semi-annual line item still rendered a
  // monthly schedule (Charles 2026-06-07). Only fall back to the contract-level
  // period (the #39 case, where cadence was set at the contract level rather
  // than per item) when EVERY line item is still at the default monthly cadence.
  const allLineItemsMonthly = lineItems.every(
    (i) => i.paymentCadence === "monthly",
  )
  const contractLevelCadence =
    toCadence(contract.performancePeriod) ?? toCadence(contract.rebatePayPeriod)
  const contractCadence = allLineItemsMonthly ? contractLevelCadence : undefined

  const capitalCost = sumCapitalCost(lineItems)
  const downPayment = sumInitialSales(lineItems)
  const financedPrincipal = sumFinancedPrincipal(lineItems)
  // For aggregation purposes, surface the FIRST item's rate / term as
  // the contract-level summary fields. Mixed-rate items still amortize
  // correctly per-item below; this is just for the headline display.
  const interestRate = lineItems[0]!.interestRate
  const termMonths = Math.max(...lineItems.map((i) => i.termMonths))

  if (financedPrincipal <= 0 || termMonths <= 0) return empty

  // Wave D — custom-shape contracts source rows from the persisted
  // table; symmetrical contracts always compute live so capital /
  // interest / term edits flow through without a write.
  let entries: AmortizationEntry[]
  let period: "monthly" | "quarterly" | "semi_annual" | "annual"
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
    period = contractCadence ?? lineItems[0]!.paymentCadence
  } else {
    // Sum per-item PMT schedules so multi-asset capital deals (the v0
    // shape) aggregate correctly. Each item amortizes against its own
    // financed principal / rate / term; we add the per-period rows
    // together to produce the combined view. Bug 3: when the contract has
    // a rebatePayPeriod, the whole schedule follows it (rebates pay down
    // capital on that cadence) instead of the line-item monthly default.
    const agg = aggregatePerItemSchedules(lineItems, contractCadence)
    entries = agg.entries
    period = agg.period
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
    // Charles audit pass-4 round-4: UNION sibling + own rebates on
    // capital rows. Earlier rounds switched between sibling-only and
    // own-only based on a "siblingHasCollected" flag, which silently
    // dropped legacy own.rebates the moment a single sibling rebate
    // appeared. For transitional data (siblings just wired up while
    // legacy own.rebates still exist), both sources should retire
    // capital. Migration is the right way to zero one out — code
    // shouldn't silently choose.
    if (contract.rebates.length > 0) {
      allRebates.push(...contract.rebates)
    }
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

  // Charles 2026-06-20 ("when I log a payment it does not record or count
  // toward the balance"): a pure CAPITAL contract earns no rebates — it is
  // paid off by logged payments/credits. Those land in ContractPeriod with
  // totalSpend=0 / rebateEarned=0 and the amount on `paymentActual`
  // (createContractTransaction). Seeded invoice rows always carry
  // totalSpend>0, so filtering on totalSpend=0 isolates user-logged
  // payments/credits. Both rebate-applied AND logged payments retire capital.
  const loggedPaymentAgg = await prisma.contractPeriod.aggregate({
    where: {
      contractId: contract.id,
      totalSpend: 0,
      rebateEarned: 0,
      paymentActual: { gt: 0 },
    },
    _sum: { paymentActual: true },
  })
  const paymentsAppliedToCapital = Number(
    loggedPaymentAgg._sum.paymentActual ?? 0,
  )
  const paidToDate = rebateAppliedToCapital + paymentsAppliedToCapital
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

  // E4 (Charles 2026-06-06): when multiple terms carry a
  // `minimumPurchaseCommitment`, surface the LOWEST (was: largest). The UI
  // discloses the choice via `minAnnualPurchaseSource` +
  // `minAnnualPurchaseCommitmentCount` ("lowest of N"). Falls back to the
  // lowest positive `spendBaseline` when no term carries an explicit
  // commitment (E1: baseline acts as the floor — user note 2026-04-23:
  // "That is technically the definition of the Baseline that is in the
  // Term/Tiers for a rebate."). Pure selection lives in
  // `selectMinAnnualPurchase` so it's unit-testable outside `"use server"`.
  const {
    value: minAnnualPurchase,
    source: minAnnualPurchaseSource,
    commitmentCount: minAnnualPurchaseCommitmentCount,
  } = selectMinAnnualPurchase(contract.terms)

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

  // E3 (Charles 2026-06-06): forward-looking pace toward the minimum annual
  // purchase. paceMonthlyRunRate = rolling12Spend / 12. projectedAnnualSpend
  // continues that pace for a full year. monthlySpendNeeded closes any gap to
  // the floor over the next 12 months. Null when there is no floor.
  const paceMonthlyRunRate = rolling12Spend / 12
  const minAnnualPace =
    minAnnualPurchase == null
      ? null
      : {
          projectedAnnualSpend: paceMonthlyRunRate * 12,
          onPaceToMeet: paceMonthlyRunRate * 12 >= minAnnualPurchase,
          monthlySpendNeeded: Math.max(
            0,
            (minAnnualPurchase - rolling12Spend) / 12,
          ),
        }

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
    if (rebatePercent > 0) {
      currentTierPercent = rebatePercent
    } else {
      // 2026-06-08 (Charles "annual spend needed to hit not coming up"):
      // below-baseline rolling-12 spend makes the engine return 0%, which
      // collapses "Annual Spend Needed to Retire Capital" to "—". Fall back
      // to the lowest DEFINED percent tier so the retirement math always
      // has a rate to project against. `rebateValue` is a fraction (0.03 =
      // 3%) → ×100 to the integer percent the retirement reducer expects.
      const firstPct = t.tiers
        .filter((x) => x.rebateType === "percent_of_spend")
        .map((x) => Number(x.rebateValue) * 100)
        .find((p) => p > 0)
      currentTierPercent = firstPct ?? 0
    }
    break
  }

  // 2026-06-08: carve-out tie-ins have no standard tier ladder — their
  // rebate is per-SKU (ContractPricing.carveOutPercent, a Decimal(5,4)
  // FRACTION). When the tier path above yielded 0% (placeholder/no tiers),
  // derive a representative rate from the carve-out lines so the retirement
  // tile shows a real "annual spend needed" estimate on a carve-out tie-in
  // instead of "—". Average rate is an estimate; the tile is a labeled
  // projection, not an earned figure.
  if (
    currentTierPercent === 0 &&
    contract.terms.some((t) => t.termType === "carve_out")
  ) {
    const carveAgg = await prisma.contractPricing.aggregate({
      where: { contractId: contract.id, carveOutPercent: { not: null } },
      _avg: { carveOutPercent: true },
    })
    const avgCarveFraction = Number(carveAgg._avg.carveOutPercent ?? 0)
    if (avgCarveFraction > 0) currentTierPercent = avgCarveFraction * 100
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
    paymentsAppliedToCapital,
    projectedEndOfTermBalance,
    contractType: contract.contractType,
    minAnnualPurchase,
    minAnnualPurchaseSource,
    minAnnualPurchaseCommitmentCount,
    minAnnualPace,
    rolling12Spend,
    currentTierPercent,
    monthsRemaining,
    capitalLineItems: lineItems,
  }
}

/**
 * Charles audit suggestion #3 — vendor-scoped Capital Amortization view.
 *
 * Vendors need to see the same financedPrincipal × interest × termMonths
 * amortization schedule on their tie-in contracts that the facility
 * sees. The data is identical; only the auth + scope clause differs.
 *
 * This wrapper:
 *   1. Authenticates as a vendor (requireVendor)
 *   2. Verifies the contract belongs to that vendor
 *   3. Re-uses the same downstream computation as the facility variant,
 *      patching the auth context inline by calling Prisma directly
 *      with `{id, vendorId: vendor.id}` scope.
 *
 * Returns the same ContractCapitalScheduleResult shape so the existing
 * <ContractAmortizationCard /> + <TieInRebateSplit /> components can
 * be reused on the vendor portal.
 */
export async function getVendorContractCapitalSchedule(
  contractId: string,
): Promise<ContractCapitalScheduleResult> {
  const { vendor } = await requireVendor()

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, vendorId: vendor.id },
    select: {
      id: true,
      name: true,
      contractType: true,
      vendorId: true,
      facilityId: true,
      effectiveDate: true,
      amortizationShape: true,
      amortizationRows: { orderBy: { periodNumber: "asc" } },
      // Charles audit suggestion #4 (v0-port): per-asset capital line items.
      capitalLineItems: { orderBy: { createdAt: "asc" } },
      rebates: { select: { collectionDate: true, rebateCollected: true } },
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
    paymentsAppliedToCapital: 0,
    projectedEndOfTermBalance: null,
    contractType: contract?.contractType ?? "usage",
    minAnnualPurchase: null,
    minAnnualPurchaseSource: null,
    minAnnualPurchaseCommitmentCount: 0,
    minAnnualPace: null,
    rolling12Spend: 0,
    currentTierPercent: 0,
    monthsRemaining: 0,
    capitalLineItems: [],
  }

  if (!contract) return empty
  // Charles audit suggestion #4 (v0-port): aggregate from line items
  // when present, fall back to legacy single-item synthesis.
  const lineItems = normalizeCapitalLineItems(contract)
  if (lineItems.length === 0) return empty

  const capitalCost = sumCapitalCost(lineItems)
  const downPayment = sumInitialSales(lineItems)
  const financedPrincipal = sumFinancedPrincipal(lineItems)
  const interestRate = lineItems[0]!.interestRate
  const termMonths = Math.max(...lineItems.map((i) => i.termMonths))

  if (financedPrincipal <= 0 || termMonths <= 0) return empty

  let entries
  let period: "monthly" | "quarterly" | "semi_annual" | "annual"
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
    period = lineItems[0]!.paymentCadence
  } else {
    const agg = aggregatePerItemSchedules(lineItems)
    entries = agg.entries
    period = agg.period
  }

  const start = new Date(contract.effectiveDate)
  const monthsStep = monthsPerPeriod(period)
  const today = new Date()

  // Cross-contract aggregation: include rebates from sibling usage
  // contracts pointing at this capital row, scoped by the vendor (the
  // sibling MUST share this vendor — different vendor's contracts
  // can't pay down this capital).
  const isTieIn = contract.contractType === "tie_in"
  const isCapital = contract.contractType === "capital"
  const allRebates: CollectedRebateLike[] = isTieIn ? [...contract.rebates] : []
  if (isCapital) {
    const siblingRebates = await prisma.rebate.findMany({
      where: {
        contract: {
          tieInCapitalContractId: contract.id,
          vendorId: vendor.id,
        },
      },
      select: { collectionDate: true, rebateCollected: true },
    })
    allRebates.push(...siblingRebates)
    if (contract.rebates.length > 0) {
      allRebates.push(...contract.rebates)
    }
  }

  const collectionsByPeriod = new Map<number, number>()
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

  const elapsedPeriods = schedule.filter(
    (r) => new Date(r.periodDate).getTime() <= today.getTime(),
  ).length

  const rebateAppliedToCapital = sumRebateAppliedToCapital(
    allRebates,
    isCapital ? "tie_in" : contract.contractType,
  )

  // Charles 2026-06-20 ("when I log a payment it does not record or count
  // toward the balance"): a pure CAPITAL contract earns no rebates — it is
  // paid off by logged payments/credits. Those land in ContractPeriod with
  // totalSpend=0 / rebateEarned=0 and the amount on `paymentActual`
  // (createContractTransaction). Seeded invoice rows always carry
  // totalSpend>0, so filtering on totalSpend=0 isolates user-logged
  // payments/credits. Both rebate-applied AND logged payments retire capital.
  const loggedPaymentAgg = await prisma.contractPeriod.aggregate({
    where: {
      contractId: contract.id,
      totalSpend: 0,
      rebateEarned: 0,
      paymentActual: { gt: 0 },
    },
    _sum: { paymentActual: true },
  })
  const paymentsAppliedToCapital = Number(
    loggedPaymentAgg._sum.paymentActual ?? 0,
  )
  const paidToDate = rebateAppliedToCapital + paymentsAppliedToCapital
  const remainingBalance = Math.max(0, financedPrincipal - paidToDate)

  // Vendor doesn't get COG / spend metrics — those are facility-side
  // numbers. Return null/0 for those fields; UI hides them anyway.
  return serialize({
    hasSchedule: true,
    capitalCost,
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
    paymentsAppliedToCapital,
    projectedEndOfTermBalance: null,
    contractType: contract.contractType,
    minAnnualPurchase: null,
    minAnnualPurchaseSource: null,
    minAnnualPurchaseCommitmentCount: 0,
    minAnnualPace: null,
    rolling12Spend: 0,
    currentTierPercent: 0,
    monthsRemaining: Math.max(
      0,
      termMonths - elapsedPeriods * monthsPerPeriod(period),
    ),
    capitalLineItems: lineItems,
  })
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

function addMonthsLocal(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function monthsPerPeriodLocal(
  p: "monthly" | "quarterly" | "semi_annual" | "annual",
): number {
  switch (p) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "semi_annual":
      return 6
    case "annual":
      return 12
  }
}

// Shared select for the projection read — used by both the facility and
// vendor entry points so the body sees one shape.
const PROJECTION_SELECT = {
  id: true,
  name: true,
  contractType: true,
  effectiveDate: true,
  expirationDate: true,
  facilityId: true,
  // Charles audit suggestion #4 (v0-port): capital lives in line items.
  capitalLineItems: { orderBy: { createdAt: "asc" as const } },
  rebates: {
    select: {
      collectionDate: true,
      rebateCollected: true,
    },
  },
} as const

const EMPTY_PROJECTION: ContractCapitalProjection = {
  hasProjection: false,
  monthlyPaydownRun: 0,
  projectedMonthsToPayoff: null,
  projectedEndOfTermBalance: 0,
  termMonthsRemaining: 0,
  paidOffBeforeTermEnd: false,
  remainingBalance: 0,
}

type _ProjectionContract = Prisma.ContractGetPayload<{
  select: typeof PROJECTION_SELECT
}>

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
    select: PROJECTION_SELECT,
  })
  if (!contract) return EMPTY_PROJECTION
  return _projectCapital(contract, facility.id)
}

/**
 * Vendor-scoped Capital Payoff Projection — 2026-06-09 facility→vendor
 * feature port ("copy similar features from facilities to the vendor
 * side"). Same math as the facility card; auth pivots on
 * `Contract.vendorId === session.vendor.id` like the other getVendor*
 * tie-in reads, and the rebate queries key off the contract's primary
 * facilityId.
 */
export async function getVendorContractCapitalProjection(
  contractId: string,
): Promise<ContractCapitalProjection> {
  const { vendor } = await requireVendor()
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, vendorId: vendor.id },
    select: PROJECTION_SELECT,
  })
  if (!contract || !contract.facilityId) return EMPTY_PROJECTION
  return _projectCapital(contract, contract.facilityId)
}

async function _projectCapital(
  contract: _ProjectionContract,
  facilityId: string,
): Promise<ContractCapitalProjection> {
  const empty = EMPTY_PROJECTION

  // Charles audit suggestion #4 (v0-port): aggregate from line items.
  const lineItems = normalizeCapitalLineItems(contract)
  if (lineItems.length === 0) return empty
  const financedPrincipal = sumFinancedPrincipal(lineItems)
  const termMonths = Math.max(...lineItems.map((i) => i.termMonths))
  if (financedPrincipal <= 0 || termMonths <= 0) return empty

  // Remaining balance — computed the same way as getContractCapitalSchedule
  // so the two surfaces never disagree. The aggregator returns the
  // densest cadence so periodDate / monthsRemaining stay aligned.
  const agg = aggregatePerItemSchedules(lineItems)
  const entries = agg.entries
  const period = agg.period
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
          facilityId,
        },
      },
      select: { collectionDate: true, rebateCollected: true },
    })
    // Round-4: union both sources to stay symmetric with the
    // schedule path and not drop legacy data when siblings appear.
    allRebates = [...sib, ...contract.rebates]
  }
  // Trailing-90 query: when this is a capital row with siblings,
  // include both the sibling chain AND the contract's own rows.
  const useSiblingTrailing90 = isCapitalRow

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
    where: useSiblingTrailing90
      ? {
          // Round-4: union — match either sibling-chain OR own row.
          OR: [
            {
              contract: {
                tieInCapitalContractId: contract.id,
                facilityId,
              },
            },
            { contractId: contract.id, facilityId },
          ],
          payPeriodEnd: { gte: ninetyDaysAgo, lte: today },
        }
      : {
          contractId: contract.id,
          facilityId,
          payPeriodEnd: { gte: ninetyDaysAgo, lte: today },
        },
    _sum: { rebateEarned: true },
  })
  const trailing90Rebate = Number(rebateAgg._sum.rebateEarned ?? 0)
  // Spec: "divided by 90 * 30 for a monthly rate" — daily average × 30.
  let monthlyPaydownRun = (trailing90Rebate / 90) * 30

  // 2026-06-08 (Charles "no projection" on a semi-annual carve-out tie-in):
  // the trailing-90-day window misses contracts that book rebates only
  // semi-annually or annually — the most recent booked period is routinely
  // >90 days old, so `trailing90Rebate` is 0 and the projection blanks even
  // though lifetime rebate HAS been applied to capital (`paidToDate` > 0).
  // When the short window is empty but capital has paid down, fall back to
  // the lifetime-average velocity (paidToDate ÷ months elapsed since the
  // contract started) so an infrequent cadence still yields a projection.
  if (monthlyPaydownRun <= 0 && paidToDate > 0) {
    const monthsElapsed = Math.max(
      1,
      (today.getTime() - new Date(contract.effectiveDate).getTime()) /
        (1000 * 60 * 60 * 24 * 30),
    )
    monthlyPaydownRun = paidToDate / monthsElapsed
  }

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
