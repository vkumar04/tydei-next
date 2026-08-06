/**
 * Result shapes for the tie-in capital schedule / projection reads.
 *
 * Extracted verbatim from `lib/actions/contracts/tie-in.ts` during the
 * large-file decomposition. The server actions stay in that file (action-id
 * stability); it re-exports these interfaces via the scanner-safe
 * `export type { ... } from` form so existing importers keep compiling.
 *
 * Framework-free (no Prisma client, no server-action imports) so Vitest
 * and client components can both consume it.
 */
import type { NormalizedCapitalLineItem } from "@/lib/contracts/capital-line-items"

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

/**
 * Shared empty result for the capital-schedule reads. The facility and
 * vendor schedule actions in `lib/actions/contracts/tie-in.ts` each carried
 * a byte-identical empty literal (differing only in `contractType`); this
 * factory replaces both. Callers pass `contract?.contractType ?? "usage"`,
 * exactly what the literals computed inline.
 */
export function emptyCapitalScheduleResult(
  contractType: string,
): ContractCapitalScheduleResult {
  return {
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
    contractType,
    minAnnualPurchase: null,
    minAnnualPurchaseSource: null,
    minAnnualPurchaseCommitmentCount: 0,
    minAnnualPace: null,
    rolling12Spend: 0,
    currentTierPercent: 0,
    monthsRemaining: 0,
    capitalLineItems: [],
  }
}
