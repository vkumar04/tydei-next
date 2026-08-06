/**
 * Shared types for the accrual-timeline builder package.
 *
 * Extracted from `lib/actions/contracts/accrual.ts` (2026-08-05 large-file
 * decomposition). The builder receives an ALREADY-AUTHORIZED contract row —
 * ownership scoping (`contractOwnershipWhere` / vendorId) stays in the
 * "use server" action file, which is the surface the auth-scope scanner
 * covers.
 */
import type { Prisma } from "@/lib/generated/prisma/client"
import type {
  buildMonthlyAccruals,
  MonthlySpend,
  MultiTermTimelineRow,
  TermAccrualConfig,
} from "@/lib/contracts/accrual"
import type { RebateMethodName } from "@/lib/rebates/calculate"
// Type-only import — erased at compile time, so the reverse type-only
// import of `AccrualContract` in market-share-display.ts is not a
// runtime cycle.
import type { MarketShareDisplayData } from "./market-share-display"

export type AccrualContract = Prisma.ContractGetPayload<{
  include: {
    terms: { include: { tiers: true } }
    productCategory: { select: { name: true } }
  }
}>

/**
 * Writer-persisted `[auto-*-accrual]` Rebate rows, fetched once by the
 * orchestrator and threaded to every pass that merges or consults them
 * (overlay-only path, F2 in-progress no-double-count guard, row assembly).
 */
export type OverlayRebateRow = Prisma.RebateGetPayload<{
  select: { rebateEarned: true; payPeriodEnd: true; notes: true }
}>

/** One walked term's scoped spend series + engine rows + config. The
 * evaluation-period re-budget mutates `rows` in place — same array the
 * assembly pass reads. */
export type PerTermResult = {
  termIndex: number
  series: MonthlySpend[]
  rows: ReturnType<typeof buildMonthlyAccruals>
  config: TermAccrualConfig
}

/** bug-bash 2026-06-11 follow-up F2: term.id → (YYYY-MM → display-only
 * in-progress accrual delta for months inside the current UNCLOSED
 * evaluation window). */
export type InProgressVolumeByTermMonth = Map<
  string,
  Map<string, { accrued: number; tierAchieved: number; rebatePercent: number }>
>

/** bugs.rtfd 2026-06-13 V: term.id → (YYYY-MM → unit-derived display
 * tier/rate for the volume family — covers EVERY month, closed windows
 * included). */
export type VolumeDisplayByTermMonth = Map<
  string,
  Map<
    string,
    {
      tierAchieved: number
      rebatePercent: number
      rebateType: string | null
      rebateValue: number
    }
  >
>

/** The timeline's UI row contract (load-bearing field names — consumed by
 * `contract-accrual-timeline.tsx` / `vendor-contract-detail-client.tsx`). */
export type TimelineRowWithVolume = MultiTermTimelineRow & {
  volume: number
  /** Bug 3: the achieved tier's rebate type for the headline term, so
   * the UI's Rate column can render `$X / period` for `fixed_rebate`,
   * `$X / unit` for `fixed_rebate_per_unit`, etc. instead of "—" for
   * any non-percent tier. */
  achievedRebateType: string | null
  /** Raw fractional/dollar `rebateValue` from the achieved tier (NOT
   * scaled by 100 — that scaling is only for percent_of_spend tiers
   * passed to the engine). Used by the UI to render unit/flat dollar
   * labels for non-percent tiers. */
  achievedRebateValue: number
  /** 2026-06-10: true for the bold evaluation-period subtotal rows
   * interleaved between the monthly rows (quarter / half / year where the
   * tier settles). Consumers summing accrual MUST skip these rows. */
  isPeriodSubtotal?: boolean
  /** bugs.rtfd 2026-06-13 M: the market share (%) of the evaluation
   * window this month belongs to — "market share at the time of
   * rebate". Null when the contract has no market_share term. */
  marketSharePercent: number | null
  /** bugs.rtfd 2026-06-13 ("not taking the 500K growth baseline into
   * account"): dollars removed by the growth baseline for the evaluation
   * window that settles on this row. 0 unless a growth-only term applied
   * a baseline. Surfaced on the period-subtotal so the UI can show
   * `rate × (spend − baseline) = accrued` instead of an unreconcilable
   * `rate × gross spend`. */
  growthBaselineApplied: number
}

/** Everything the final row-assembly pass needs, threaded explicitly from
 * the orchestrator (`build-timeline.ts`). */
export type AssembleRowsContext = {
  contract: AccrualContract
  termsWithTiers: AccrualContract["terms"]
  VOLUME_WALK_TERM_TYPES: ReadonlySet<string>
  termConfigs: TermAccrualConfig[]
  method: RebateMethodName
  monthsTimeline: string[]
  unionSpendByMonth: Map<string, number>
  perTermResults: PerTermResult[]
  volumeByMonth: Map<string, number>
  inProgressVolumeByTermMonth: InProgressVolumeByTermMonth
  volumeDisplayByTermMonth: VolumeDisplayByTermMonth
  overlayRebateRows: OverlayRebateRow[]
  marketShareDisplay: MarketShareDisplayData | null
  isVolumeRebate: boolean
}
