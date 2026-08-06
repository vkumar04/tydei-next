/**
 * Monthly accrual timeline builder for one contract — the body behind
 * `getAccrualTimeline` / `getVendorAccrualTimeline`
 * (`lib/actions/contracts/accrual.ts`). Moved here verbatim in the
 * 2026-08-05 large-file decomposition; the actions stay in the "use
 * server" file (action-id stability + auth-scope scanner coverage) and
 * hand this builder an ALREADY-AUTHORIZED contract row.
 *
 * Charles 2026-04-26 #62: split the auth + contract-resolution out
 * of the body so vendors can read the same timeline scoped through
 * their session via `getVendorAccrualTimeline`. The body is
 * facility-id-pinned (COG queries hang off facilityId), but the
 * contract's primary facility is the same data point in either
 * scope, so the inner helper is reusable.
 */
import { prisma } from "@/lib/db"
import { buildMonthlyAccruals } from "@/lib/contracts/accrual"
import type { RebateMethodName } from "@/lib/rebates/calculate"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"
import { serialize } from "@/lib/serialize"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
} from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
import { applyEvaluationRebudget } from "./evaluation-rebudget"
import { computeMarketShareDisplayForContract } from "./market-share-display"
import { buildMonthlySpendSeriesFromCogRows } from "./month-buckets"
import { buildOverlayOnlyTimeline } from "./overlay-only-path"
import { assembleTimelineRows } from "./assemble-rows"
import { buildTermConfigs } from "./term-configs"
import { buildVolumeSeriesState } from "./volume-series"
import type { AccrualContract } from "./types"

export async function buildAccrualTimelineForContract(
  contract: AccrualContract,
  facilityId: string | null,
) {
  // Bug 3 (2026-05-17): flag the timeline as volume-driven if ANY term
  // is a volume_rebate. The UI uses this to surface a "Volume (units)"
  // column alongside Spend so users can see the qty that drove tier
  // achievement.
  const isVolumeRebate = contract.terms.some(
    (t) => t.termType === "volume_rebate",
  )

  if (!facilityId) {
    // No primary facility — fall through with empty result. Matches
    // the early-return shape below.
    return serialize({
      rows: [],
      method: "cumulative" as RebateMethodName,
      termLabels: [] as Array<{
        termIndex: number
        termName: string
        evaluationPeriod: string
      }>,
      cumulativeReset: "monthly" as const,
      isVolumeRebate,
    })
  }

  // Charles R5.6: pricing-only contracts are not rebate-bearing. The
  // accrual ledger must be empty for them — no phantom rows from COG.
  if (!contractTypeEarnsRebates(contract.contractType)) {
    return serialize({
      rows: [],
      method: "cumulative" as RebateMethodName,
      termLabels: [] as Array<{
        termIndex: number
        termName: string
        evaluationPeriod: string
      }>,
      cumulativeReset: "monthly" as const,
      isVolumeRebate,
    })
  }

  // Charles R5.29: iterate all terms and sum per-month accruals so the
  // timeline matches what `recomputeAccrualForContract` writes to the
  // Rebate ledger. Pre-fix, multi-term contracts showed only the first
  // term's accrued values in the Performance tab timeline.
  //
  // 2026-06-09 ("market share rebate performance is not calculating
  // correctly or showing the rate"): market_share / compliance_rebate
  // tiers store PERCENT thresholds (0-100) in spendMin — walking dollar
  // spend against them is the recurring type-confusion class (spend ≫ 100
  // always "achieves" the top tier). Exclude them from the tier walk;
  // their real accrual is persisted by the threshold writer as
  // `[auto-threshold-accrual]` Rebate rows and overlaid below.
  //
  // bugs.rtfd 2026-06-11 A1: the hand-rolled exclusion above missed
  // `carve_out` / `tie_in`, whose auto-created PLACEHOLDER tier
  // (spendMin 0, rebateValue 0) entered the walk and made the timeline's
  // Tier column escalate 1→2→3 with cumulative spend on contracts that
  // have no real ladder. Use the canonical guard
  // `hasSpendDollarTierLadder` (CLAUDE.md invariants table, "Spend-tier
  // display eligibility") — it encodes the full rule: spend-dollar
  // thresholds only, no carve_out / tie_in, tiers present, and at least
  // one non-zero rebateValue (excludes all-zero placeholder ladders).
  // Carve-out accrual stays on its overlay path below.
  //
  // EXCEPTION: the volume-dispatcher family — `volume_rebate`,
  // `rebate_per_use`, `capitated_pricing_rebate` (the term types
  // `recompute-accrual.ts` routes through `recomputeVolumeAccrualForTerm`;
  // all persist `[auto-volume-accrual]` rows) — stays in the walk even
  // though the canonical guard classifies them as count-threshold. The
  // 2026-06-10 volume fix relies on the walk for their Volume display
  // column and term attribution (walk index), while their ACCRUAL
  // contribution is zeroed at the contribution site below and earned
  // comes from the `[auto-volume-accrual]` overlay — so no double count.
  // bugs.rtfd 2026-06-13 V: the displayed Tier / Rate no longer comes
  // from the walk for `volume_rebate` terms — the dollar walk compared
  // SPEND against the UNIT thresholds these terms store in `spendMin`
  // (prod: $2.4M ≥ "5001" → showed tier 2 / $7-unit while the accrual
  // correctly ran tier 1 / $5-unit). They now derive from
  // window-cumulative UNITS via `selectAchievedVolumeTier` (see
  // `volumeDisplayByTermMonth` below); `rebate_per_use` /
  // `capitated_pricing_rebate` keep the walk fallback until they grow a
  // unit series here. Pinned by
  // `lib/actions/contracts/__tests__/accrual-volume.test.ts`.
  //
  // The two remaining dispatcher types — `po_rebate`
  // (`[auto-po-accrual]`) and `payment_rebate` (`[auto-invoice-accrual]`)
  // — are NOT walked (no spend-dollar ladder, no display dependency on
  // the walk); their persisted writer rows are overlaid below so a
  // contract whose ONLY term is one of these still renders a timeline
  // instead of a blank card (2026-06-11 A1 review).
  const VOLUME_WALK_TERM_TYPES = new Set([
    "volume_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
  ])
  const termsWithTiers = contract.terms.filter(
    (t) =>
      hasSpendDollarTierLadder(t) ||
      (VOLUME_WALK_TERM_TYPES.has(t.termType) && t.tiers.length > 0),
  )
  // 2026-06-09 (Charles "contracts on the vendor side is broken"): a
  // carve-out contract's tiers are PHANTOM (rebateValue 0 scaffolds), so the
  // tier engine accrues $0 for them. The real accrual for carve-out AND
  // threshold (market_share / compliance) terms is persisted by their
  // dedicated writers — the doctrine-canonical earned source. Overlay those
  // rows into the timeline buckets below.
  //
  // 2026-06-10 (Charles "Volume rebates not showing any accrued rebates"):
  // volume terms are the same class — `recomputeVolumeAccrualForTerm`
  // persists `[auto-volume-accrual]` rows, but the overlay never fetched
  // that prefix while the tier walk forces per-unit tiers to rebateValue 0
  // — so the timeline showed Tier 1 / "$5.00 / unit" and Accrued $0
  // forever. Volume rows now overlay; the walk's accrual contribution for
  // volume terms is zeroed below so percent-tier volume terms can't double
  // count.
  //
  // 2026-06-11 (A1 review): cover EVERY dispatcher-written prefix. The
  // volume family (`rebate_per_use`, `capitated_pricing_rebate`) shares
  // `[auto-volume-accrual]` with `volume_rebate`; `po_rebate` persists
  // `[auto-po-accrual]` and `payment_rebate` persists
  // `[auto-invoice-accrual]` (see `lib/contracts/recompute/po.ts` /
  // `invoice.ts`). Pre-fix, a contract whose only term was one of these
  // rendered a fully blank timeline despite persisted accrual rows.
  const OVERLAY_TERM_TYPES = new Set([
    "carve_out",
    "market_share",
    "compliance_rebate",
    // volume-dispatcher family → [auto-volume-accrual]
    "volume_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate", // → [auto-po-accrual]
    "payment_rebate", // → [auto-invoice-accrual]
  ])
  const hasOverlayTerm = contract.terms.some((t) =>
    OVERLAY_TERM_TYPES.has(t.termType),
  )
  const overlayRebateRows = hasOverlayTerm
    ? await prisma.rebate.findMany({
        where: {
          contractId: contract.id,
          OR: [
            { notes: { startsWith: "[auto-carve-out-accrual]" } },
            { notes: { startsWith: "[auto-threshold-accrual]" } },
            { notes: { startsWith: "[auto-volume-accrual]" } },
            { notes: { startsWith: "[auto-po-accrual]" } },
            { notes: { startsWith: "[auto-invoice-accrual]" } },
          ],
        },
        // notes carry `term:<id>` + `tier N` — parsed below so the timeline
        // can attribute each overlay row to ITS term in the per-term
        // breakdown (Charles 2026-06-10: "there are two terms one is market
        // share the other is spend rebate the timeline should reflect that").
        select: { rebateEarned: true, payPeriodEnd: true, notes: true },
      })
    : []
  // Timeline horizon — shared by the overlay-only path below AND the
  // normal tier-walk path: clamp at today or contract expiry.
  const end = new Date(
    Math.min(new Date().getTime(), contract.expirationDate.getTime()),
  )

  // bugs.rtfd 2026-06-13 M (Charles "Spend term with a market share term.
  // Not showing the market share calculations … Also show the market
  // share at the time of rebate in a column"): per-evaluation-window
  // market share, computed by the threshold WRITER's own exported
  // helpers (`buildThresholdEvaluationWindows` +
  // `computePerPeriodMarketShare` — never a parallel reimplementation).
  // Two visibility gaps this closes, display-only (no Rebate writes):
  //   (a) a window whose share sits below the lowest tier threshold pays
  //       $0 and the writer persists NO row (`periodPayment <= 0` gate),
  //       so the term contributed nothing to the timeline —
  //       indistinguishable from broken. Window-end months now carry a
  //       $0 contribution with the window's tier (0 → rate "—") so the
  //       term and its share stay visible.
  //   (b) "market share at the time of rebate" — every month gets
  //       `marketSharePercent` (its window's share) for the new column.
  const marketShareDisplay = await computeMarketShareDisplayForContract(
    contract,
    facilityId,
  )

  if (termsWithTiers.length === 0) {
    return buildOverlayOnlyTimeline({
      contract,
      facilityId,
      isVolumeRebate,
      OVERLAY_TERM_TYPES,
      overlayRebateRows,
      end,
      marketShareDisplay,
    })
  }

  const termConfigs = buildTermConfigs(termsWithTiers)

  // Method reported alongside `rows` is the primary (first) term's —
  // used for the "cumulative vs marginal" label on the timeline header.
  const method: RebateMethodName =
    (termsWithTiers[0].rebateMethod ?? "cumulative") as RebateMethodName

  // Charles W1.U-A — fetch COG once with a union-of-categories pre-filter
  // so the in-memory partition below receives only rows we might want.
  // When any term is all-products the union is {} and we fall back to
  // the vendor-wide query (pre-W1.U behavior).
  const termScopes = termsWithTiers.map((term) => ({
    appliesTo: term.appliesTo,
    categories: term.categories,
  }))
  // 2026-06-08: expand to drifted COG category variants (canonical match) so
  // the timeline doesn't drop case/word-order-different rows. Reused for the
  // union SQL fetch, per-term in-memory partition, and the volume fallback.
  const cogCategoryUniverse = await facilityCogCategoryUniverse(facilityId)
  const unionCategoryWhere = buildUnionCategoryWhereClause(
    termScopes,
    cogCategoryUniverse,
  )

  // Charles R5.12 — bucket spend by the actual transaction date, not the
  // DB insertion timestamp. Using `createdAt` collapsed every seeded
  // record into the single month the seed ran, which made the Accrual
  // Timeline and Performance Spend-by-Period panels show all activity in
  // one column and every other month as $0.
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      // 2026-06-09 audit: group-aware vendor set (recurring drift class) —
      // bare contract.vendorId blanked the timeline on grouped contracts
      // whose spend sits under member vendors (prod: $0 shown vs $561,207
      // writer basis). Same canonical helper the recompute writer uses.
      vendorId: { in: contractVendorIds(contract) },
      transactionDate: {
        gte: contract.effectiveDate,
        lte: end,
      },
      ...unionCategoryWhere,
    },
    select: {
      transactionDate: true,
      extendedPrice: true,
      category: true,
    },
  })

  // bugs.rtfd 2026-06-13: the displayed "Spend" column is the contract's
  // in-scope spend per month counted ONCE (the union of all term scopes),
  // NOT the sum of each term's scoped series. Summing double-counted on a
  // multi-term contract where two all-products terms cover the same spend
  // (prod: 2 terms → 2×, $7,433,959 shown for a real $3,716,979). Tier
  // qualification stays per-term (per-term series, below); only the
  // single Spend/Cumulative display number uses the deduplicated union.
  const unionSpendSeries = buildMonthlySpendSeriesFromCogRows(
    cogRecords,
    unionCategoryWhere,
    contract.effectiveDate,
    end,
  )
  const unionSpendByMonth = new Map(
    unionSpendSeries.map((s) => [s.month, s.spend]),
  )

  // Per-term accrual series — each term sees ONLY the categories it is
  // scoped to (W1.U-A). Mirrors `recomputeAccrualForContract` so the
  // on-the-fly timeline and the persisted Rebate ledger agree. The
  // month-bucketing itself lives in `buildMonthlySpendSeriesFromCogRows`
  // (module-level), shared with the overlay-only early path (A4).
  const perTermResults = termsWithTiers.map((term, idx) => {
    const termScope = { appliesTo: term.appliesTo, categories: term.categories }
    const termCategoryWhere = buildCategoryWhereClause(
      termScope,
      cogCategoryUniverse,
    )
    const series = buildMonthlySpendSeriesFromCogRows(
      cogRecords,
      termCategoryWhere,
      contract.effectiveDate,
      end,
    )
    const rows = buildMonthlyAccruals(
      series,
      termConfigs[idx].tiers,
      termConfigs[idx].method,
      termConfigs[idx].evaluationPeriod,
    )
    return { termIndex: idx, series, rows, config: termConfigs[idx] }
  })

  // Retroactive evaluation-window re-budget — see
  // `evaluation-rebudget.ts` (2026-06-09 prod audit Bug 1). Mutates
  // `perTermResults[*].rows` in place.
  applyEvaluationRebudget({ perTermResults, termsWithTiers, contract, end })

  const monthsTimeline =
    perTermResults[0]?.series.map((s) => s.month) ?? []

  const {
    volumeByMonth,
    inProgressVolumeByTermMonth,
    volumeDisplayByTermMonth,
  } = await buildVolumeSeriesState({
    contract,
    facilityId,
    end,
    isVolumeRebate,
    termsWithTiers,
    cogCategoryUniverse,
    overlayRebateRows,
  })

  return assembleTimelineRows({
    contract,
    termsWithTiers,
    VOLUME_WALK_TERM_TYPES,
    termConfigs,
    method,
    monthsTimeline,
    unionSpendByMonth,
    perTermResults,
    volumeByMonth,
    inProgressVolumeByTermMonth,
    volumeDisplayByTermMonth,
    overlayRebateRows,
    marketShareDisplay,
    isVolumeRebate,
  })
}
