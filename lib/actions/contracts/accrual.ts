"use server"

/**
 * Monthly accrual timeline for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 *
 * Charles 2026-04-26 #62: split the auth + contract-resolution out
 * of the body so vendors can read the same timeline scoped through
 * their session via `getVendorAccrualTimeline` below. The body is
 * facility-id-pinned (COG queries hang off facilityId), but the
 * contract's primary facility is the same data point in either
 * scope, so the inner helper is reusable.
 */
import { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  buildMonthlyAccruals,
  buildEvaluationPeriodAccruals,
  type EvaluationPeriod,
  type MonthlySpend,
  type MultiTermTimelineRow,
  type TermAccrualConfig,
} from "@/lib/contracts/accrual"
import type { TierLike, RebateMethodName } from "@/lib/rebates/calculate"
import { calculateCumulative, calculateMarginal } from "@/lib/rebates/calculate"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"
import { serialize } from "@/lib/serialize"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
} from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { scaleRebateValueForEngine } from "@/lib/rebates/calculate"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
import { resolveOverlayTierRate } from "@/lib/contracts/tier-rebate-label"
// bug-bash 2026-06-11 follow-up F2: the volume writer's tier math +
// window bucketing, exported as pure helpers so the timeline's
// display-only in-progress accrual is writer-consistent by construction
// (the writer calls the same functions — canonical-helper culture).
import {
  computeVolumeTierRebate,
  currentOpenVolumeWindow,
  normalizeVolumeTiers,
  selectAchievedVolumeTier,
} from "@/lib/contracts/recompute/volume"
// bugs.rtfd 2026-06-13 M: the threshold writer's window grid + per-period
// market-share computation, exported so the timeline shows the SAME share
// the writer pays on — including below-threshold windows the writer never
// persists ($0 payment rows are skipped by its `periodPayment <= 0` gate).
import {
  buildThresholdEvaluationWindows,
  computePerPeriodMarketShare,
} from "@/lib/contracts/recompute/threshold"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"
import type { RebateTier } from "@/lib/rebates/engine/types"

export async function getAccrualTimeline(contractId: string) {
  const { facility } = await requireFacility()

  // Charles audit round-11 BLOCKER: scope by ownership.
  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      // bugs.rtfd 2026-06-13 M: the market-share display overlay scopes
      // its categories exactly like the threshold writer's dispatcher,
      // whose fallback is `contract.productCategory?.name`.
      productCategory: { select: { name: true } },
    },
  })
  return _buildAccrualTimelineForContract(contract, facility.id)
}

/**
 * Vendor-scoped read of the accrual timeline. The vendor session
 * authorizes on `Contract.vendorId === session.vendor.id`; the COG
 * query underneath still keys off the contract's primary facilityId
 * (the canonical "this contract's spend lives at this facility"
 * pivot — same one the facility-side caller uses).
 *
 * Charles 2026-04-26 #62: paired with the new vendor Accruals tab in
 * `vendor-contract-detail-client.tsx` to bring the vendor surface to
 * facility parity.
 */
export async function getVendorAccrualTimeline(contractId: string) {
  const { vendor } = await requireVendor()
  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId, vendorId: vendor.id },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      // bugs.rtfd 2026-06-13 M: see facility-scoped query above.
      productCategory: { select: { name: true } },
    },
  })
  return _buildAccrualTimelineForContract(contract, contract.facilityId)
}

type _AccrualContract = Prisma.ContractGetPayload<{
  include: {
    terms: { include: { tiers: true } }
    productCategory: { select: { name: true } }
  }
}>

async function _buildAccrualTimelineForContract(
  contract: _AccrualContract,
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
    // No spend-dollar tier terms — but overlay rows (carve-out /
    // market-share / compliance / dispatcher accrual) may still exist.
    //
    // bugs.rtfd 2026-06-11 A4 ("STILL not showing"): pre-fix this path
    // rendered ONLY the months that happened to carry ledger rows, with
    // hardcoded spend 0 / cumulativeSpend 0 / tier 0 / rate 0 / empty
    // termLabels / "monthly" reset — so a contract whose ONLY term is
    // market_share showed 2 bare annual rows with $0 spend everywhere
    // while its hero market-share was correct. Three prior fixes
    // (3e24e201, 02081997, 59333750) all repaired the NORMAL walk path;
    // this early return was never updated.
    //
    // The threshold family (market_share / compliance_rebate) accrues on
    // category-scoped COG spend, so this path now runs the SAME scoped
    // monthly bucketing the normal walk uses and merges the overlay
    // accrual into those months.
    //
    // bugs.rtfd 2026-06-12 R3 ("Carve out performance is unchanged here
    // in accruals"): A4 deliberately left carve_out overlay-only — wrong
    // call. A Stryker Mako tie-in carve-out still showed only its 4
    // semi-annual ledger rows, Spend $0 everywhere, "Latest cumulative
    // spend: $0". Carve-outs now get a real monthly Spend series too,
    // mirroring the WRITER's own basis (`recomputeCarveOutAccrualForTerm`
    // in lib/contracts/recompute/carve-out.ts): COG rows whose
    // vendorItemNo matches a ContractPricing line with a carveOutPercent
    // (normalizeSku on BOTH sides — never raw ===), contract-pinned OR
    // vendor-pinned-unmatched (group-aware vendor set), matchStatus
    // on_contract / price_variance, clamped to the term's effective
    // window. Tier / Rate stay 0 ("—"): the ladder is a placeholder and
    // carve-outs earn per-SKU — never resolve tier rates for them.
    // po / payment (count basis) terms keep overlay-only rows.
    const overlayTerms = contract.terms.filter((t) =>
      OVERLAY_TERM_TYPES.has(t.termType),
    )
    const thresholdSpendTerms = overlayTerms.filter(
      (t) =>
        t.termType === "market_share" || t.termType === "compliance_rebate",
    )
    const carveOutTerms = overlayTerms.filter(
      (t) => t.termType === "carve_out",
    )

    type EarlyTimelineRow = {
      month: string
      spend: number
      cumulativeSpend: number
      accruedAmount: number
      tierAchieved: number
      rebatePercent: number
      termContributions: Array<{
        termIndex: number
        accruedAmount: number
        tierAchieved: number
        rebatePercent: number
      }>
      volume: number
      achievedRebateType: string | null
      achievedRebateValue: number
      /** bugs.rtfd 2026-06-13 M: the market share (%) of the evaluation
       * window this month belongs to; null when the contract has no
       * market_share term. */
      marketSharePercent: number | null
    }
    const emptyRow = (month: string): EarlyTimelineRow => ({
      month,
      spend: 0,
      cumulativeSpend: 0,
      accruedAmount: 0,
      tierAchieved: 0,
      rebatePercent: 0,
      termContributions: [],
      volume: 0,
      achievedRebateType: null,
      achievedRebateValue: 0,
      marketSharePercent: null,
    })
    const rowByMonth = new Map<string, EarlyTimelineRow>()

    if (thresholdSpendTerms.length > 0) {
      // Same canonical scoping as the normal walk (A4): union-of-categories
      // pre-filter expanded to drifted COG variants + group-aware vendor
      // set — never raw category `in` or bare vendorId.
      const cogCategoryUniverse = await facilityCogCategoryUniverse(facilityId)
      const unionCategoryWhere = buildUnionCategoryWhereClause(
        thresholdSpendTerms.map((t) => ({
          appliesTo: t.appliesTo,
          categories: t.categories,
        })),
        cogCategoryUniverse,
      )
      const cogRows = await prisma.cOGRecord.findMany({
        where: {
          facilityId,
          vendorId: { in: contractVendorIds(contract) },
          transactionDate: { gte: contract.effectiveDate, lte: end },
          ...unionCategoryWhere,
        },
        select: { transactionDate: true, extendedPrice: true, category: true },
      })
      const series = buildMonthlySpendSeriesFromCogRows(
        cogRows,
        unionCategoryWhere,
        contract.effectiveDate,
        end,
      )
      // Don't render a wall of all-$0 months on a contract with neither
      // in-scope spend nor persisted accrual — keep the blank state.
      const hasAnySpend = series.some((s) => s.spend > 0)
      if (hasAnySpend || overlayRebateRows.length > 0) {
        for (const s of series) {
          const row = emptyRow(s.month)
          row.spend = s.spend
          rowByMonth.set(s.month, row)
        }
      }
    }

    if (carveOutTerms.length > 0) {
      // bugs.rtfd 2026-06-12 R3: writer-basis spend series for carve-out
      // terms. Step 1 — the carved SKU set, exactly the writer's pricing
      // query (`carveOutPercent: { not: null }`).
      const carvedPricingLines = await prisma.contractPricing.findMany({
        where: { contractId: contract.id, carveOutPercent: { not: null } },
        select: { vendorItemNo: true },
      })
      const carvedSkuKeys = new Set(
        carvedPricingLines
          .map((p) => normalizeSku(p.vendorItemNo))
          .filter((k) => k !== ""),
      )
      // No carved lines → the writer earns on nothing; keep overlay-only
      // rows (pre-R3 shape) and skip the COG query entirely.
      if (carvedSkuKeys.size > 0) {
        const vendorIds = contractVendorIds(contract)
        // Step 2 — the writer's COG selection: rows pinned to THIS
        // contract, plus vendor-pinned rows not yet contract-matched
        // (group-aware vendor set — recurring drift class), matched
        // statuses only.
        const carveCogRows = await prisma.cOGRecord.findMany({
          where: {
            facilityId,
            transactionDate: { gte: contract.effectiveDate, lte: end },
            OR: [
              { contractId: contract.id },
              ...(vendorIds.length
                ? [{ contractId: null, vendorId: { in: vendorIds } }]
                : []),
            ],
            matchStatus: { in: ["on_contract", "price_variance"] },
          },
          select: {
            vendorItemNo: true,
            transactionDate: true,
            extendedPrice: true,
          },
        })
        // Step 3 — carved-SKU match (normalizeSku, never raw ===) +
        // per-term effective-window clamp (union across carve-out terms).
        // The writer treats effectiveEnd as INCLUSIVE of its whole day
        // (`endOfDay()` in recompute/carve-out.ts) — mirror that, or a
        // transaction later on the end date would show $0 here while the
        // writer earned on it.
        const endOfDayUTC = (d: Date): number =>
          Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            23,
            59,
            59,
            999,
          )
        const inAnyCarveTermWindow = (d: Date): boolean =>
          carveOutTerms.some(
            (t) =>
              (!t.effectiveStart || d >= t.effectiveStart) &&
              (!t.effectiveEnd || d.getTime() <= endOfDayUTC(t.effectiveEnd)),
          )
        const carvedRows = carveCogRows.filter(
          (r) =>
            r.transactionDate != null &&
            carvedSkuKeys.has(normalizeSku(r.vendorItemNo)) &&
            inAnyCarveTermWindow(r.transactionDate),
        )
        const carveSeries = buildMonthlySpendSeriesFromCogRows(
          carvedRows,
          {}, // SKU scoping already applied — no category filter
          contract.effectiveDate,
          end,
        )
        const hasAnyCarveSpend = carveSeries.some((s) => s.spend > 0)
        if (hasAnyCarveSpend || overlayRebateRows.length > 0) {
          for (const s of carveSeries) {
            // ADD into any month the threshold branch already created so
            // mixed threshold + carve-out contracts don't lose either
            // basis.
            const existing = rowByMonth.get(s.month)
            if (existing) {
              existing.spend += s.spend
            } else {
              const row = emptyRow(s.month)
              row.spend = s.spend
              rowByMonth.set(s.month, row)
            }
          }
        }
      }
    }

    // Term attribution mirrors the normal path's overlay labels: every
    // overlay term gets a stable index (contract order) so contributions
    // and labels line up in the per-term breakout.
    const overlayIndexByTermId = new Map(
      overlayTerms.map((t, i) => [t.id, i] as const),
    )
    const earlyTermLabels = overlayTerms.map((t, i) => ({
      termIndex: i,
      termName: t.termName ?? "Rebate term",
      evaluationPeriod: t.evaluationPeriod ?? "annual",
    }))

    for (const cr of overlayRebateRows) {
      if (!cr.payPeriodEnd) continue
      const monthKey = `${cr.payPeriodEnd.getUTCFullYear()}-${String(
        cr.payPeriodEnd.getUTCMonth() + 1,
      ).padStart(2, "0")}`
      const earned = Number(cr.rebateEarned ?? 0)
      const termId = cr.notes?.match(/term:(\S+)/)?.[1] ?? null
      const tierAchieved = Number(cr.notes?.match(/tier (\d+)/)?.[1] ?? 0)
      const overlayTerm = termId
        ? contract.terms.find((t) => t.id === termId)
        : undefined
      // A2 helper: percent tiers scale fraction→percent; dollar tier types
      // stay 0 (never render $ as %).
      const overlayRate = resolveOverlayTierRate(overlayTerm, tierAchieved)
      const termIndex = termId
        ? (overlayIndexByTermId.get(termId) ?? null)
        : null

      // Keep accrual months with no spend: append a row outside the COG
      // series range instead of dropping the dollars.
      let target = rowByMonth.get(monthKey)
      if (!target) {
        target = emptyRow(monthKey)
        rowByMonth.set(monthKey, target)
      }
      target.accruedAmount += earned
      if (termIndex !== null && earned > 0) {
        const existing = target.termContributions.find(
          (c) => c.termIndex === termIndex,
        )
        if (existing) {
          existing.accruedAmount += earned
          if (tierAchieved > existing.tierAchieved) {
            existing.tierAchieved = tierAchieved
            existing.rebatePercent = overlayRate
          }
        } else {
          target.termContributions.push({
            termIndex,
            accruedAmount: earned,
            tierAchieved,
            rebatePercent: overlayRate,
          })
        }
      }
      // Row headline: best achieved tier wins (same tiebreak the walk
      // uses — higher tier, then higher rate). Carve-out / po / payment
      // notes carry no `tier N`, so their rows keep tier 0 / rate 0 (A1).
      if (
        tierAchieved > target.tierAchieved ||
        (tierAchieved === target.tierAchieved &&
          overlayRate > target.rebatePercent)
      ) {
        const achievedTier = overlayTerm?.tiers.find(
          (t) => t.tierNumber === tierAchieved,
        )
        target.tierAchieved = tierAchieved
        target.rebatePercent = overlayRate
        target.achievedRebateType = achievedTier?.rebateType ?? null
        target.achievedRebateValue = achievedTier
          ? Number(achievedTier.rebateValue)
          : 0
      }
    }

    // bugs.rtfd 2026-06-13 M: market-share visibility on the early path.
    // Persisted overlay rows above stay authoritative; this only (1)
    // stamps each month with its window's share for the Market Share
    // column and (2) keeps the term visible on windows the writer never
    // persisted (below-threshold → $0 payment → no row): the window-end
    // month gets a $0 contribution carrying the share-derived tier/rate.
    if (marketShareDisplay) {
      for (const [m, share] of marketShareDisplay.shareByMonth) {
        const row = rowByMonth.get(m)
        if (row) row.marketSharePercent = share
      }
      for (const we of marketShareDisplay.windowEnds) {
        const termIndex = overlayIndexByTermId.get(we.termId)
        if (termIndex === undefined) continue
        let target = rowByMonth.get(we.month)
        if (!target) {
          target = emptyRow(we.month)
          target.marketSharePercent =
            marketShareDisplay.shareByMonth.get(we.month) ?? null
          rowByMonth.set(we.month, target)
        }
        const existing = target.termContributions.find(
          (c) => c.termIndex === termIndex,
        )
        // A persisted writer row already represents this window — never
        // second-guess the ledger with the display recompute.
        if (existing) continue
        target.termContributions.push({
          termIndex,
          accruedAmount: 0,
          tierAchieved: we.tierAchieved,
          rebatePercent: we.rebatePercent,
        })
        // Single-term early-path UIs render the HEADLINE columns, not
        // the per-term breakdown — surface the window's tier/rate there
        // too (tier 0 keeps the "—" rate by construction).
        if (
          we.tierAchieved > target.tierAchieved ||
          (we.tierAchieved === target.tierAchieved &&
            we.rebatePercent > target.rebatePercent)
        ) {
          const msTerm = contract.terms.find((t) => t.id === we.termId)
          const achievedTier = msTerm?.tiers.find(
            (t) => t.tierNumber === we.tierAchieved,
          )
          target.tierAchieved = we.tierAchieved
          target.rebatePercent = we.rebatePercent
          target.achievedRebateType = achievedTier?.rebateType ?? null
          target.achievedRebateValue = achievedTier
            ? Number(achievedTier.rebateValue)
            : 0
        }
      }
    }

    const earlyRows = Array.from(rowByMonth.values()).sort((a, b) =>
      a.month < b.month ? -1 : 1,
    )
    if (earlyRows.length === 0) {
      // Nothing to show — keep the exact pre-A4 blank shape.
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

    // Cadence: copy the normal path's mapping exactly — a single term
    // keeps its evaluation period (monthly / quarterly / semi_annual pass
    // through; anything else is annual); multi-term falls back to
    // lifetime. Do NOT drop semi_annual (recurring regression class).
    const earlyEval: "monthly" | "quarterly" | "semi_annual" | "annual" | "lifetime" =
      overlayTerms.length === 1
        ? overlayTerms[0].evaluationPeriod === "monthly" ||
          overlayTerms[0].evaluationPeriod === "quarterly" ||
          overlayTerms[0].evaluationPeriod === "semi_annual"
          ? overlayTerms[0].evaluationPeriod
          : "annual"
        : "lifetime"
    let earlyRunningCumulative = 0
    let earlyPeriodKey: string | null = null
    for (const r of earlyRows) {
      const pKey = periodKeyForEval(r.month, earlyEval)
      if (pKey !== earlyPeriodKey) {
        earlyPeriodKey = pKey
        earlyRunningCumulative = 0
      }
      earlyRunningCumulative += r.spend
      r.cumulativeSpend = earlyRunningCumulative
    }

    return serialize({
      rows: earlyRows,
      method: (overlayTerms[0]?.rebateMethod ??
        "cumulative") as RebateMethodName,
      termLabels: earlyTermLabels,
      cumulativeReset: earlyEval,
      isVolumeRebate,
    })
  }

  // Charles W1.S — scale `rebateValue` by 100 at the Prisma boundary for
  // `percent_of_spend` tiers. `ContractTier.rebateValue` is stored as a
  // fraction (0.03 = 3%), but the rebate engine in
  // `lib/rebates/calculate.ts` expects integer percent (3 = 3%).
  // Without this scaling, the Accrual Timeline's Rate column rendered the
  // raw fraction (e.g. "0.03%" for a 3% tier) and the Accrued column was
  // 100× too small. Mirrors the convention in
  // `lib/rebates/calculate.ts#computeRebateFromPrismaTiers` and
  // `lib/contracts/tier-rebate-label.ts` — scale at the boundary, not in
  // the engine. See CLAUDE.md "Rebate engine units" rule.
  // Bug #16 (2026-05-08, Vick screenshots): the accrual-timeline rate
  // column was rendering raw `tier.rebateValue` for `fixed_rebate`
  // tiers, so a $50,000 / $500,000 flat rebate showed up as "50000%" /
  // "500000%" in the Rate column and the Accrued column was billions
  // of dollars. The legacy engine in `lib/rebates/calculate.ts`
  // already short-circuits to `tier.fixedRebateAmount` when set
  // (`shared/cumulative.ts:20`), but the mapper here never populated
  // that field. For `fixed_rebate`, route the dollar value through
  // `fixedRebateAmount` and force `rebateValue` to 0 so the engine's
  // percent math returns 0 dollars on its own and the Rate column
  // shows 0% (a fixed rebate has no percent rate by definition).
  //
  // For `fixed_rebate_per_unit` / `per_procedure_rebate` tiers, the
  // spend-accrual timeline is the wrong surface to render them on
  // (those rebates are unit-driven, not spend-driven), but until the
  // timeline gets a per-rebate-type viewer we at least zero out the
  // rate so it doesn't display absurd percentages — accrual on those
  // termTypes is computed via the dedicated VOLUME / per-use writers
  // in `lib/contracts/recompute/`, not this timeline.
  const isFixedDollarRebateType = (rt: string | null | undefined): boolean =>
    rt === "fixed_rebate" ||
    rt === "fixed_rebate_per_unit" ||
    rt === "per_procedure_rebate"

  const termConfigs: TermAccrualConfig[] = termsWithTiers.map((term) => {
    const tiers: TierLike[] = term.tiers.map((t) => {
      const isFixed = isFixedDollarRebateType(t.rebateType)
      const isTrueFixedRebate = t.rebateType === "fixed_rebate"
      return {
        tierNumber: t.tierNumber,
        tierName: t.tierName ?? null,
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax ? Number(t.spendMax) : null,
        // Force 0 for any non-percent rebate type so the Rate column
        // never renders a dollar amount as a percent. Percent tiers
        // keep the existing × 100 fraction-to-percent scaling.
        rebateValue: isFixed
          ? 0
          : scaleRebateValueForEngine(t.rebateValue, t.rebateType),
        // Only `fixed_rebate` is truly a flat-dollar tier; route its
        // dollars through `fixedRebateAmount` so the engine pays it on
        // tier qualification. Per-unit / per-procedure types remain
        // null — those are unit-driven, not flat, and shouldn't be
        // paid out here.
        fixedRebateAmount: isTrueFixedRebate ? Number(t.rebateValue) : null,
      }
    })
    const evaluationPeriod: EvaluationPeriod =
      term.evaluationPeriod === "monthly" ||
      term.evaluationPeriod === "quarterly" ||
      term.evaluationPeriod === "semi_annual"
        ? term.evaluationPeriod
        : "annual"
    return {
      tiers,
      method: (term.rebateMethod ?? "cumulative") as RebateMethodName,
      evaluationPeriod,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
      // 2026-06-09: thread the baseline like the writer does so the
      // retroactive period re-budget below applies the same
      // baseline-above math (Bug #22 rule: spendBaseline > 0 → tiers
      // evaluate max(0, periodSpend − proRatedBaseline)).
      spendBaseline:
        term.spendBaseline === null || term.spendBaseline === undefined
          ? null
          : Number(term.spendBaseline),
      baselineType: term.baselineType ?? null,
      // bugs.rtfd 2026-06-13 #1: gate baseline subtraction on growthOnly
      // so the timeline matches the writer (growth-only subtraction).
      growthOnly: term.growthOnly ?? false,
    }
  })

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

  // 2026-06-09 (Charles "much larger rebate numbers vs performance" — prod
  // audit Bug 1): the per-month tier walk is NOT retroactive. When
  // cumulative spend crosses a tier mid-period, months already accrued at
  // 0%/a lower rate were never trued up, so the timeline under-reported vs
  // the persisted ledger on an IDENTICAL COG basis (live Arthrex:
  // $96,264.06 shown vs $421,341.49 booked). The earlier annual-only
  // re-budget summed the same under-counted monthly slices, so it didn't
  // help. For EVERY non-monthly cadence, recompute each evaluation window
  // through the WRITER's engine (buildEvaluationPeriodAccruals — whole-
  // window spend, retroactive, baseline-aware) and re-budget the window's
  // earned into its period-end month. Mid-window months keep their
  // tier/rate progress columns with $0 accrued — matching the ledger,
  // which books at period close. Timeline ≡ ledger by construction.
  const nowForBudget = new Date()
  for (const r of perTermResults) {
    if (r.config.evaluationPeriod === "monthly" || r.rows.length === 0) {
      continue
    }
    const term = termsWithTiers[r.termIndex]
    const windowAnchor = term.effectiveStart ?? contract.effectiveDate
    // bugs.rtfd 2026-06-13 #2: end-of-day the date-only end bounds so a
    // window ending on the same calendar day as the term/contract end
    // counts as complete (matches the recompute writer + threshold path).
    // Without it an annual term ending on a period boundary lost its
    // final window and the timeline showed $0.
    const endOfDayUTC = (d: Date) =>
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
    const termWindowEnd = term.effectiveEnd
      ? new Date(
          Math.min(
            nowForBudget.getTime(),
            endOfDayUTC(term.effectiveEnd),
            endOfDayUTC(end),
          ),
        )
      : new Date(Math.min(nowForBudget.getTime(), endOfDayUTC(end)))
    // bugs.rtfd 2026-06-13 #1: growth-only baseline subtraction (matches
    // the recompute writer). "From dollar one" earns on full spend.
    const growthSubtract =
      r.config.growthOnly === true &&
      r.config.spendBaseline != null &&
      r.config.spendBaseline > 0
    const buckets = buildEvaluationPeriodAccruals(
      r.series,
      r.config.tiers,
      r.config.method,
      r.config.evaluationPeriod,
      windowAnchor,
      {
        boundedUntil: termWindowEnd,
        spendBaseline: growthSubtract ? (r.config.spendBaseline ?? null) : null,
        growthBased: growthSubtract,
      },
    )
    // Zero the per-month slices (tier/rate progress columns stay), then
    // land each completed window's retroactive earned on its period-end
    // month. Incomplete windows (periodEnd in the future) stay $0 — the
    // rebate isn't earned until the period closes, same as the ledger.
    for (let i = 0; i < r.rows.length; i++) {
      r.rows[i] = { ...r.rows[i], accruedAmount: 0 }
    }
    const rowIdxByMonth = new Map(r.rows.map((row, i) => [row.month, i]))
    let bucketedSpend = 0
    for (const b of buckets) {
      bucketedSpend += b.totalSpend
      if (b.rebateEarned <= 0) continue
      if (b.periodEnd.getTime() > nowForBudget.getTime()) continue
      const endKey = `${b.periodEnd.getUTCFullYear()}-${String(
        b.periodEnd.getUTCMonth() + 1,
      ).padStart(2, "0")}`
      const idx = rowIdxByMonth.get(endKey) ?? r.rows.length - 1
      r.rows[idx] = {
        ...r.rows[idx],
        accruedAmount: r.rows[idx].accruedAmount + b.rebateEarned,
        tierAchieved: b.tierAchieved,
        rebatePercent: b.rebatePercent,
        // bugs.rtfd 2026-06-13: carry the window's growth-baseline cut onto
        // its period-end month so the subtotal can render the basis.
        growthBaselineApplied:
          (r.rows[idx].growthBaselineApplied ?? 0) + b.growthBaselineApplied,
      }
    }
    // Open / partial TAIL window — the engine (like the writer) drops a
    // window whose natural end exceeds boundedUntil, so a contract that
    // expired mid-window (or whose current window is still running) would
    // show $0 for that stretch. Keep the 2026-04-25 display intent: show
    // the tail's accrued-TO-DATE on the latest in-range month. Closed
    // windows above stay ≡ ledger.
    const seriesSpend = r.series.reduce((s, m) => s + m.spend, 0)
    const tailSpend = Math.max(0, seriesSpend - bucketedSpend)
    if (tailSpend > 0 && r.rows.length > 0) {
      const widthMonths =
        r.config.evaluationPeriod === "quarterly"
          ? 3
          : r.config.evaluationPeriod === "semi_annual"
            ? 6
            : 12
      const proRated =
        growthSubtract && r.config.spendBaseline
          ? r.config.spendBaseline * (widthMonths / 12)
          : 0
      const tailTierSpend = Math.max(0, tailSpend - proRated)
      const res =
        r.config.method === "marginal"
          ? calculateMarginal(tailTierSpend, r.config.tiers)
          : calculateCumulative(tailTierSpend, r.config.tiers)
      if (res.rebateEarned > 0) {
        const last = r.rows.length - 1
        r.rows[last] = {
          ...r.rows[last],
          accruedAmount: r.rows[last].accruedAmount + res.rebateEarned,
          tierAchieved: res.tierAchieved,
          rebatePercent: res.rebatePercent,
          // Open/partial tail window: surface the baseline cut applied to
          // the to-date growth slice (same proRated basis as the engine).
          growthBaselineApplied:
            (r.rows[last].growthBaselineApplied ?? 0) +
            Math.max(0, tailSpend - tailTierSpend),
        }
      }
    }
  }

  const monthsTimeline =
    perTermResults[0]?.series.map((s) => s.month) ?? []

  // Bug 3 (2026-05-17): build a per-month volume series for the UI.
  // Mirrors the volume-rebate writer (`lib/contracts/recompute/volume.ts`):
  //   - CPT mode (term has cptCodes): count distinct case+CPT
  //     occurrences from Case.procedures within the month.
  //   - COG-fallback (no cptCodes): sum COGRecord.quantity within the
  //     month, scoped to the term's category filter.
  // We sum across every volume_rebate term so a month's "Volume" reads
  // as the total qty that drove ANY volume tier this month.
  const volumeByMonth = new Map<string, number>()
  // bug-bash 2026-06-11 follow-up F2: per-term per-month unit + in-scope
  // spend maps, captured while the volume series is built. They feed the
  // display-only in-progress accrual for the current UNCLOSED evaluation
  // window below (the writer only persists rows for CLOSED windows).
  const volumeUnitsByTermMonth = new Map<string, Map<string, number>>()
  const volumeSpendByTermMonth = new Map<string, Map<string, number>>()
  if (isVolumeRebate) {
    const volumeTerms = termsWithTiers.filter(
      (t) => t.termType === "volume_rebate",
    )
    const cptVolumeTerms = volumeTerms.filter(
      (t) => Array.isArray(t.cptCodes) && t.cptCodes.length > 0,
    )
    const cogVolumeTerms = volumeTerms.filter(
      (t) => !t.cptCodes || t.cptCodes.length === 0,
    )

    // CPT-mode buckets: load cases once, fan out per term + dedupe by
    // (caseId, cptCode) within each (term, month) bucket so the count
    // matches what the writer persists.
    if (cptVolumeTerms.length > 0) {
      const cases = await prisma.case.findMany({
        where: {
          facilityId,
          dateOfSurgery: { gte: contract.effectiveDate, lte: end },
        },
        select: {
          id: true,
          dateOfSurgery: true,
          procedures: { select: { cptCode: true } },
        },
      })
      for (const term of cptVolumeTerms) {
        const allowed = new Set(term.cptCodes)
        const seenPerMonth = new Map<string, Set<string>>()
        for (const c of cases) {
          const d = c.dateOfSurgery
          if (!d) continue
          if (term.effectiveStart && d < term.effectiveStart) continue
          if (term.effectiveEnd && d > term.effectiveEnd) continue
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
          let seen = seenPerMonth.get(key)
          if (!seen) {
            seen = new Set<string>()
            seenPerMonth.set(key, seen)
          }
          for (const p of c.procedures) {
            if (!allowed.has(p.cptCode)) continue
            seen.add(`case:${c.id}|cpt:${p.cptCode}`)
          }
        }
        const termUnits = new Map<string, number>()
        for (const [m, set] of seenPerMonth) {
          volumeByMonth.set(m, (volumeByMonth.get(m) ?? 0) + set.size)
          termUnits.set(m, set.size)
        }
        // F2: CPT counts feed the in-progress display too (the helper
        // works on counts regardless of source). No per-month COG spend
        // basis here, so percent_of_spend tiers display $0 mid-window —
        // status quo, no regression; the writer's CPT path sources its
        // spend separately at window close.
        volumeUnitsByTermMonth.set(term.id, termUnits)
      }
    }

    // COG-fallback: sum COGRecord.quantity per month across in-scope
    // categories. Reload COG with `quantity` (the upper-block select
    // intentionally omits it) — one extra query is fine, only volume
    // contracts hit this path.
    if (cogVolumeTerms.length > 0) {
      const unionWhereForVolume = buildUnionCategoryWhereClause(
        cogVolumeTerms.map((t) => ({
          appliesTo: t.appliesTo,
          categories: t.categories,
        })),
        cogCategoryUniverse,
      )
      const cogVolRows = await prisma.cOGRecord.findMany({
        where: {
          facilityId,
          // bug-bash 2026-06-11 follow-up F1, same drift class as the
          // 2026-06-09 audit fix above: group-aware vendor set — bare
          // contract.vendorId under-counted the displayed "Volume (units)"
          // on grouped contracts whose spend sits under member vendors,
          // while the group-aware writer counted the full vendor basis.
          vendorId: { in: contractVendorIds(contract) },
          transactionDate: { gte: contract.effectiveDate, lte: end },
          ...unionWhereForVolume,
        },
        select: {
          transactionDate: true,
          quantity: true,
          // F2: per-month in-scope spend basis so percent_of_spend volume
          // tiers can show in-progress display accrual mid-window.
          extendedPrice: true,
          category: true,
        },
      })
      for (const term of cogVolumeTerms) {
        const termScope = {
          appliesTo: term.appliesTo,
          categories: term.categories,
        }
        const where = buildCategoryWhereClause(termScope, cogCategoryUniverse)
        const categoryIn = where.category?.in ?? null
        const categorySet = categoryIn ? new Set(categoryIn) : null
        const termUnits = new Map<string, number>()
        const termSpend = new Map<string, number>()
        for (const r of cogVolRows) {
          const d = r.transactionDate
          if (!d) continue
          if (term.effectiveStart && d < term.effectiveStart) continue
          if (term.effectiveEnd && d > term.effectiveEnd) continue
          if (categorySet && !categorySet.has(r.category ?? "")) continue
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
          volumeByMonth.set(key, (volumeByMonth.get(key) ?? 0) + (r.quantity ?? 0))
          termUnits.set(key, (termUnits.get(key) ?? 0) + (r.quantity ?? 0))
          termSpend.set(
            key,
            (termSpend.get(key) ?? 0) +
              (r.extendedPrice == null ? 0 : Number(r.extendedPrice)),
          )
        }
        volumeUnitsByTermMonth.set(term.id, termUnits)
        volumeSpendByTermMonth.set(term.id, termSpend)
      }
    }
  }

  // bug-bash 2026-06-11 follow-up F2 (Charles screenshot — bug A5
  // residual): an annual volume term showed per-month units (802, 485…)
  // and a real "$11.00 / unit" rate in the timeline but Accrued $0 for
  // every month until the first evaluation window CLOSED, because the
  // writer (`lib/contracts/recompute/volume.ts`) only persists
  // `[auto-volume-accrual]` rows for closed windows (W1.W-B1 honesty
  // rule — ledger earned stays `payPeriodEnd <= today`; the writer's
  // gating is intentionally untouched) and the walk zeroes volume-term
  // accrual in favor of that overlay. Spend terms, meanwhile, show LIVE
  // walk accrual every month on the SAME timeline — the inconsistency is
  // the bug. Close the gap with a DISPLAY-ONLY in-progress accrual for
  // months inside the current UNCLOSED window, computed by the writer's
  // own exported helper (`computeVolumeTierRebate` on window-cumulative
  // units — never a reimplementation). Each month is attributed the
  // DELTA of the window-to-date value, so when a tier boundary is
  // crossed mid-window the cumulative-method recompute-on-window-total
  // behavior is preserved and the month series sums to exactly what the
  // writer WILL persist at window close. Scope: timeline display only —
  // this file writes no Rebate rows; Earned cards / ledger are untouched.
  const inProgressVolumeByTermMonth = new Map<
    string,
    Map<
      string,
      { accrued: number; tierAchieved: number; rebatePercent: number }
    >
  >()
  if (isVolumeRebate) {
    for (const term of termsWithTiers) {
      if (term.termType !== "volume_rebate") continue
      // PO-basis terms count PurchaseOrders, not COG units — the unit
      // series captured above would be the wrong basis for them.
      if (term.volumeType === "purchase_order") continue
      const termUnits = volumeUnitsByTermMonth.get(term.id)
      if (!termUnits) continue
      const window = currentOpenVolumeWindow({
        contractEffectiveDate: contract.effectiveDate,
        contractExpirationDate: contract.expirationDate,
        effectiveStart: term.effectiveStart,
        effectiveEnd: term.effectiveEnd,
        evaluationPeriod: term.evaluationPeriod,
      })
      if (!window) continue
      // No-double-count guard: by construction the unclosed window holds
      // no persisted overlay rows, but ASSERT it — any month at or before
      // the latest persisted `[auto-volume-accrual]` payPeriodEnd for
      // this term is already covered by the overlay and must not also
      // receive in-progress display accrual.
      const termOverlayPrefix = `[auto-volume-accrual] term:${term.id}`
      let latestOverlayEnd: Date | null = null
      for (const cr of overlayRebateRows) {
        if (!cr.payPeriodEnd) continue
        if (!cr.notes?.startsWith(termOverlayPrefix)) continue
        if (!latestOverlayEnd || cr.payPeriodEnd > latestOverlayEnd) {
          latestOverlayEnd = cr.payPeriodEnd
        }
      }
      const latestOverlayMonth = latestOverlayEnd
        ? `${latestOverlayEnd.getUTCFullYear()}-${String(
            latestOverlayEnd.getUTCMonth() + 1,
          ).padStart(2, "0")}`
        : null

      const sortedTiers = normalizeVolumeTiers(term.tiers)
      const termSpend = volumeSpendByTermMonth.get(term.id)
      const out = new Map<
        string,
        { accrued: number; tierAchieved: number; rebatePercent: number }
      >()
      let cumulativeUnits = 0
      let cumulativeSpend = 0
      let prevWindowToDate = 0
      // Walk the open window's months up to the timeline horizon (`end`
      // = min(today, expiry)) — never past the window's natural close.
      const horizon = new Date(
        Math.min(end.getTime(), window.windowEnd.getTime()),
      )
      const cursor = new Date(
        Date.UTC(
          window.windowStart.getUTCFullYear(),
          window.windowStart.getUTCMonth(),
          1,
        ),
      )
      const lastMonth = new Date(
        Date.UTC(horizon.getUTCFullYear(), horizon.getUTCMonth(), 1),
      )
      while (cursor <= lastMonth) {
        const key = `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, "0")}`
        cumulativeUnits += termUnits.get(key) ?? 0
        cumulativeSpend += termSpend?.get(key) ?? 0
        const { achieved, rebateEarned } = computeVolumeTierRebate(
          sortedTiers,
          cumulativeUnits,
          cumulativeSpend,
        )
        const delta = rebateEarned - prevWindowToDate
        prevWindowToDate = rebateEarned
        const coveredByOverlay =
          latestOverlayMonth !== null && key <= latestOverlayMonth
        if (!coveredByOverlay && delta !== 0) {
          out.set(key, {
            accrued: delta,
            tierAchieved: achieved?.tierNumber ?? 0,
            // Same A2 helper the overlay path uses: percent tiers scale
            // fraction→percent; dollar tiers stay 0 (never render $ as %).
            rebatePercent: resolveOverlayTierRate(
              term,
              achieved?.tierNumber ?? 0,
            ),
          })
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
      if (out.size > 0) inProgressVolumeByTermMonth.set(term.id, out)
    }
  }

  // bugs.rtfd 2026-06-13 V (prod cmqbcw4wd00040ypgudy9modb): the volume
  // family's displayed Tier / Rate came from the DOLLAR tier walk, whose
  // cumulative SPEND was compared against the term's UNIT thresholds
  // (stored in spendMin/spendMax) — the recurring dollars-vs-units
  // type-confusion class. $2.4M spend ≥ "5001" showed "Tier 2 ·
  // $7.00/unit" on rows whose ACCRUAL was correctly $5/unit (3,873
  // window units) — the display contradicted the math on the same row.
  //
  // Fix: derive the displayed tier/rate for EVERY month from
  // window-cumulative UNITS via the writer's own exported
  // `selectAchievedVolumeTier` (the same helper the accrual math and the
  // persisting writer use — no parallel ladder logic). Window bucketing
  // reuses `currentOpenVolumeWindow` as a pure month→window probe
  // (`today` = a timestamp inside the month) so the grid anchoring is
  // writer-identical for closed AND open windows. Closed windows get the
  // same rule — e.g. a 2024 window ending at 7,755 units displays tier 2
  // / "$7.00 / unit", matching its persisted 7,755 × $7 overlay row.
  const volumeDisplayByTermMonth = new Map<
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
  >()
  if (isVolumeRebate) {
    for (const term of termsWithTiers) {
      if (term.termType !== "volume_rebate") continue
      // PO-basis terms count PurchaseOrders, not COG units — the unit
      // series captured above would be the wrong basis for them.
      if (term.volumeType === "purchase_order") continue
      const termUnits = volumeUnitsByTermMonth.get(term.id)
      if (!termUnits) continue
      const sortedTiers = normalizeVolumeTiers(term.tiers)
      const termStartMs = Math.max(
        contract.effectiveDate.getTime(),
        term.effectiveStart?.getTime() ?? -Infinity,
      )
      const horizonMs = Math.min(
        end.getTime(),
        term.effectiveEnd?.getTime() ?? Infinity,
      )
      if (horizonMs < termStartMs) continue
      const out = new Map<
        string,
        {
          tierAchieved: number
          rebatePercent: number
          rebateType: string | null
          rebateValue: number
        }
      >()
      const termStart = new Date(termStartMs)
      const horizon = new Date(horizonMs)
      const cursor = new Date(
        Date.UTC(termStart.getUTCFullYear(), termStart.getUTCMonth(), 1),
      )
      const lastMonth = new Date(
        Date.UTC(horizon.getUTCFullYear(), horizon.getUTCMonth(), 1),
      )
      let windowStartMs: number | null = null
      let windowUnits = 0
      while (cursor <= lastMonth) {
        const key = `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, "0")}`
        // Probe: any timestamp inside this month past the term clamp —
        // the writer-grid window containing it is exactly the first
        // window still open as of that instant.
        const probe = new Date(Math.max(cursor.getTime(), termStartMs) + 1)
        const window = currentOpenVolumeWindow({
          contractEffectiveDate: contract.effectiveDate,
          contractExpirationDate: contract.expirationDate,
          effectiveStart: term.effectiveStart,
          effectiveEnd: term.effectiveEnd,
          evaluationPeriod: term.evaluationPeriod,
          today: probe,
        })
        if (window) {
          if (windowStartMs !== window.windowStart.getTime()) {
            // New evaluation window — cumulative units reset.
            windowStartMs = window.windowStart.getTime()
            windowUnits = 0
          }
          windowUnits += termUnits.get(key) ?? 0
          const achieved = selectAchievedVolumeTier(sortedTiers, windowUnits)
          out.set(key, {
            tierAchieved: achieved?.tierNumber ?? 0,
            // A2 rule via the canonical helper: percent tiers scale
            // fraction→percent; dollar tiers stay 0 (never render $ as %).
            rebatePercent: resolveOverlayTierRate(
              term,
              achieved?.tierNumber ?? 0,
            ),
            rebateType: achieved?.rebateType ?? null,
            rebateValue: achieved?.rebateValue ?? 0,
          })
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
      if (out.size > 0) volumeDisplayByTermMonth.set(term.id, out)
    }
  }

  // Charles 2026-04-23 — the Cumulative column previously ran a
  // lifetime running sum across all months, which made a quarterly-
  // eval contract look like tier qualification was using lifetime
  // spend even though the engine's `windowSpend` already resets at
  // each period boundary. Users (Charles, Preferred Supplier-Provider
  // Rebate Agreement) flagged this as a math bug: "the spend resets
  // it is not based on the cumulative at that point. So after the
  // quarter they have to spend 200K to get to the next year."
  //
  // Fix the display to match the math: reset the cumulative at the same
  // period boundaries the engine uses (monthly → every month; quarterly →
  // each calendar quarter; semi_annual → H1/H2; annual → year start).
  // bugs.rtfd 2026-06-13: when ALL terms share one cadence (e.g. two
  // annual terms), reset on that cadence so "Cumulative" matches the
  // per-period tier qualification ("the math based on the rebate period
  // not the cumulative spend"). Only fall back to lifetime when terms
  // genuinely run on DIFFERENT cadences (no single correct reset point).
  const allSameEval =
    termConfigs.length > 0 &&
    termConfigs.every(
      (c) => c.evaluationPeriod === termConfigs[0].evaluationPeriod,
    )
  const primaryEval = allSameEval
    ? termConfigs[0].evaluationPeriod
    : ("lifetime" as const)
  function periodKeyFor(month: string): string {
    // Shared with the overlay-only early path (A4) — see
    // `periodKeyForEval` at module level.
    return periodKeyForEval(month, primaryEval)
  }
  let runningCumulative = 0
  let currentPeriodKey: string | null = null
  type TimelineRowWithVolume = MultiTermTimelineRow & {
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
  const rows: TimelineRowWithVolume[] = monthsTimeline.map((month, i) => {
    // bugs.rtfd 2026-06-13: union spend for the month, counted ONCE (no
    // cross-term double-count). Accrual still sums per term below.
    const totalSpend = unionSpendByMonth.get(month) ?? 0
    let totalAccrued = 0
    // bugs.rtfd 2026-06-13: sum the growth-baseline cut the per-term
    // evaluation-period walk stamped on this month (only the period-end
    // month of a growth term is non-zero).
    let totalGrowthBaseline = 0
    let bestTier = 0
    let bestPercent = 0
    let bestContribution = -1
    let bestRebateType: string | null = null
    let bestRebateValue = 0
    const contributions: MultiTermTimelineRow["termContributions"] = []

    const monthStart = monthKeyToDate(month)
    const monthEnd = monthKeyEndOfMonth(month)

    for (const { termIndex, rows: tRows, config, series } of perTermResults) {
      const sourceTerm = termsWithTiers[termIndex]
      const startOk =
        config.effectiveStart == null || config.effectiveStart <= monthEnd
      const endOk =
        config.effectiveEnd == null || config.effectiveEnd >= monthStart
      if (!startOk || !endOk) continue

      const row = tRows[i]
      const entry = series[i]
      if (!row || !entry) continue
      // (display spend is the deduplicated union total, set above — do
      // NOT add per-term spend here or multi-term contracts double-count.)

      // Charles 2026-04-25: previously this `continue`d on
      // accruedAmount <= 0, which dropped tier visibility for any
      // month with $0 accrual. After the annual-eval re-budget
      // (above), mid-year months legitimately have accrual=0 but
      // still need their tier displayed in the Tier column. Always
      // record the contribution; only the contributions list (which
      // the UI uses to break down "who paid what this month") skips
      // zero rows so we don't visually clutter the breakdown.
      //
      // 2026-06-10: volume-family terms' (volume_rebate / rebate_per_use /
      // capitated_pricing_rebate) accrual comes from the persisted
      // `[auto-volume-accrual]` overlay rows (the canonical earned source);
      // the walk keeps providing their tier/rate/volume display but must
      // not contribute accrual or it would double-count with the overlay.
      //
      // bug-bash 2026-06-11 follow-up F2: months inside the current
      // UNCLOSED evaluation window get the display-only in-progress delta
      // computed above (writer's own helper on window-cumulative units),
      // so volume terms walk live like spend terms do. Months covered by
      // persisted overlay rows carry NO in-progress entry by construction
      // — no double count.
      const isVolumeWalkTerm = VOLUME_WALK_TERM_TYPES.has(sourceTerm.termType)
      const inProgressVolume = isVolumeWalkTerm
        ? inProgressVolumeByTermMonth.get(sourceTerm.id)?.get(month)
        : undefined
      // bugs.rtfd 2026-06-13 V: unit-derived display tier/rate for the
      // volume family — covers EVERY month (closed windows included),
      // unlike the F2 in-progress entries which only exist for open-
      // window months with a non-zero delta. Both come from the same
      // writer helpers on the same unit series, so they always agree.
      const volumeDisplay = isVolumeWalkTerm
        ? volumeDisplayByTermMonth.get(sourceTerm.id)?.get(month)
        : undefined
      const walkAccrual = isVolumeWalkTerm
        ? (inProgressVolume?.accrued ?? 0)
        : row.accruedAmount
      totalAccrued += walkAccrual
      totalGrowthBaseline += Number(row.growthBaselineApplied ?? 0)
      if (walkAccrual > 0) {
        contributions.push({
          termIndex,
          accruedAmount: walkAccrual,
          // V: unit-derived tier/rate first; then the F2 in-progress
          // entry; non-volume terms keep the walk's values.
          tierAchieved:
            volumeDisplay?.tierAchieved ??
            inProgressVolume?.tierAchieved ??
            row.tierAchieved,
          rebatePercent:
            volumeDisplay?.rebatePercent ??
            inProgressVolume?.rebatePercent ??
            row.rebatePercent,
        })
      }
      // Pick the term with the highest tier as the row's headline
      // tier. For zero-accrual months (annual-eval pre-year-end), we
      // still want the term's CURRENT tier on the row so the user
      // sees their tracking progress. Tiebreak on rate when tiers
      // match, then on accrual size.
      //
      // bugs.rtfd 2026-06-13 V: volume-family candidates use the
      // unit-derived tier/rate — never the dollar walk's (which compared
      // dollars against unit thresholds).
      const candidateTier = volumeDisplay
        ? volumeDisplay.tierAchieved
        : row.tierAchieved
      const candidatePercent = volumeDisplay
        ? volumeDisplay.rebatePercent
        : row.rebatePercent
      const tierBeat = candidateTier > bestTier
      const sameTierBetterRate =
        candidateTier === bestTier && candidatePercent > bestPercent
      const sameTierBetterAccrual =
        candidateTier === bestTier &&
        candidatePercent === bestPercent &&
        row.accruedAmount > bestContribution
      if (tierBeat || sameTierBetterRate || sameTierBetterAccrual) {
        bestContribution = row.accruedAmount
        bestTier = candidateTier
        bestPercent = candidatePercent
        if (volumeDisplay) {
          // The achieved VOLUME tier's own type + raw value (e.g.
          // fixed_rebate_per_unit · 5 → "$5.00 / unit").
          bestRebateType = volumeDisplay.rebateType
          bestRebateValue = volumeDisplay.rebateValue
        } else {
          const sourceTier = sourceTerm.tiers.find(
            (t) => t.tierNumber === row.tierAchieved,
          )
          bestRebateType = sourceTier?.rebateType ?? null
          bestRebateValue = sourceTier ? Number(sourceTier.rebateValue) : 0
        }
      }
    }

    const pKey = periodKeyFor(month)
    if (pKey !== currentPeriodKey) {
      currentPeriodKey = pKey
      runningCumulative = 0
    }
    runningCumulative += totalSpend
    return {
      month,
      spend: totalSpend,
      cumulativeSpend: runningCumulative,
      accruedAmount: totalAccrued,
      tierAchieved: bestTier,
      rebatePercent: bestPercent,
      termContributions: contributions,
      volume: volumeByMonth.get(month) ?? 0,
      achievedRebateType: bestRebateType,
      achievedRebateValue: bestRebateValue,
      // bugs.rtfd 2026-06-13 M: stamped from the window shares below.
      marketSharePercent: null,
      // bugs.rtfd 2026-06-13: growth-baseline cut summed across this month's
      // contributing terms; the period-end month carries the window's full
      // cut, which the subtotal merge rolls up.
      growthBaselineApplied: totalGrowthBaseline,
    }
  })

  // Tell the UI what reset cadence the Cumulative column uses so the
  // header can label it "Cumulative (quarter-to-date)" etc.
  const cumulativeReset:
    | "monthly"
    | "quarterly"
    | "semi_annual"
    | "annual"
    | "lifetime" = primaryEval

  // 2026-06-09: overlay the persisted carve-out / threshold / volume accrual
  // into the MONTHLY rows (see hasOverlayTerm above). Each overlay Rebate row
  // lands in the month containing its payPeriodEnd; months with no
  // tier-engine row are appended so accrual outside the COG-spend window
  // still shows.
  //
  // 2026-06-10 (Charles "there are two terms one is market share the other
  // is spend rebate the timeline should reflect that"): overlay rows now
  // ATTRIBUTE to their term — the writer notes carry `term:<id>` and
  // `tier N`, so each row joins termContributions under its own label and
  // the multi-term breakdown shows BOTH terms instead of silently folding
  // the market-share dollars into an unlabeled total.
  const overlayTermLabels: Array<{
    termIndex: number
    termName: string
    evaluationPeriod: string
  }> = []
  // bugs.rtfd 2026-06-13 M: hoisted out of the `overlayRebateRows.length`
  // guard — the market-share visibility pass below must register the
  // term's label / month rows even when the writer persisted ZERO rows
  // (below-threshold windows), which was exactly the invisibility bug.
  const walkIndexByTermId = new Map(
    termsWithTiers.map((t, i) => [t.id, i] as const),
  )
  const overlayIndexByTermId = new Map<string, number>()
  const overlayIndexFor = (termId: string | null): number | null => {
    if (!termId) return null
    const walkIdx = walkIndexByTermId.get(termId)
    if (walkIdx !== undefined) return walkIdx
    const existingIdx = overlayIndexByTermId.get(termId)
    if (existingIdx !== undefined) return existingIdx
    const term = contract.terms.find((t) => t.id === termId)
    if (!term) return null
    const idx = termsWithTiers.length + overlayTermLabels.length
    overlayIndexByTermId.set(termId, idx)
    overlayTermLabels.push({
      termIndex: idx,
      termName: term.termName ?? "Rebate term",
      evaluationPeriod: term.evaluationPeriod ?? "annual",
    })
    return idx
  }
  const byKey = new Map(rows.map((r) => [r.month, r]))

  if (overlayRebateRows.length > 0) {
    for (const cr of overlayRebateRows) {
      if (!cr.payPeriodEnd) continue
      const monthKey = `${cr.payPeriodEnd.getUTCFullYear()}-${String(
        cr.payPeriodEnd.getUTCMonth() + 1,
      ).padStart(2, "0")}`
      const earned = Number(cr.rebateEarned ?? 0)
      const termId = cr.notes?.match(/term:(\S+)/)?.[1] ?? null
      const tierFromNotes = Number(cr.notes?.match(/tier (\d+)/)?.[1] ?? 0)
      // bugs.rtfd 2026-06-13 V: volume-writer notes carry NO `tier N` —
      // fall back to the unit-derived display tier for the term-month so
      // a closed window's overlay contribution shows its real tier.
      const tierAchieved =
        tierFromNotes > 0
          ? tierFromNotes
          : termId
            ? (volumeDisplayByTermMonth.get(termId)?.get(monthKey)
                ?.tierAchieved ?? 0)
            : 0
      const termIndex = overlayIndexFor(termId)
      // bugs.rtfd 2026-06-11 A2: the writer note carries only `tier N` —
      // resolve the achieved tier's RATE from the contributing term's
      // tiers (already loaded on contract.terms). Pre-fix this was
      // hardcoded 0, so a market-share term at "Tier 2 · 9.0%" showed its
      // dollar contribution with no rate in the per-term breakout.
      // Percent tiers scale fraction→percent inside the helper; dollar
      // tier types stay 0 (never render $ as %).
      const overlayTerm = termId
        ? contract.terms.find((t) => t.id === termId)
        : undefined
      const overlayRate = resolveOverlayTierRate(overlayTerm, tierAchieved)

      let target = byKey.get(monthKey)
      if (!target) {
        target = {
          month: monthKey,
          spend: 0,
          cumulativeSpend: 0,
          accruedAmount: 0,
          tierAchieved: 0,
          rebatePercent: 0,
          termContributions: [],
          volume: 0,
          achievedRebateType: null,
          achievedRebateValue: 0,
          marketSharePercent: null,
          growthBaselineApplied: 0,
        }
        byKey.set(monthKey, target)
        rows.push(target)
      }
      target.accruedAmount += earned
      if (termIndex !== null && earned > 0) {
        const existing = target.termContributions.find(
          (c) => c.termIndex === termIndex,
        )
        if (existing) {
          existing.accruedAmount += earned
          if (tierAchieved > existing.tierAchieved) {
            existing.tierAchieved = tierAchieved
            // A2: the higher tier wins the merge — carry its rate too.
            existing.rebatePercent = overlayRate
          }
        } else {
          target.termContributions.push({
            termIndex,
            accruedAmount: earned,
            tierAchieved,
            rebatePercent: overlayRate,
          })
        }
      }
    }
  }

  // bugs.rtfd 2026-06-13 M: market-share visibility on the normal path.
  // (1) Register the term's label + a $0 window-end contribution for any
  // evaluation window the writer persisted NO row for (below-threshold
  // → periodPayment 0 → skipped) so the term never silently vanishes;
  // (2) stamp every month with its window's share for the Market Share
  // column. Persisted overlay rows above stay authoritative — windows
  // they already cover are never double-annotated.
  if (marketShareDisplay) {
    for (const we of marketShareDisplay.windowEnds) {
      const termIndex = overlayIndexFor(we.termId)
      if (termIndex === null) continue
      let target = byKey.get(we.month)
      if (!target) {
        target = {
          month: we.month,
          spend: 0,
          cumulativeSpend: 0,
          accruedAmount: 0,
          tierAchieved: 0,
          rebatePercent: 0,
          termContributions: [],
          volume: 0,
          achievedRebateType: null,
          achievedRebateValue: 0,
          marketSharePercent: null,
          growthBaselineApplied: 0,
        }
        byKey.set(we.month, target)
        rows.push(target)
      }
      const existing = target.termContributions.find(
        (c) => c.termIndex === termIndex,
      )
      if (existing) continue
      target.termContributions.push({
        termIndex,
        accruedAmount: 0,
        tierAchieved: we.tierAchieved,
        rebatePercent: we.rebatePercent,
      })
    }
    for (const r of rows) {
      r.marketSharePercent =
        marketShareDisplay.shareByMonth.get(r.month) ?? null
    }
  }

  // Keep chronological order (YYYY-MM sorts lexicographically).
  rows.sort((a, b) => (a.month < b.month ? -1 : 1))

  // 2026-06-10 (Charles "the monthly data was removed it is just showing
  // cumulative annuals"): the 2026-06-09 quarterly fix collapsed per-month
  // rows into evaluation-period buckets, which fixed the tier-math window
  // but deleted monthly visibility. Now: keep EVERY month row, and insert a
  // bold subtotal row at each evaluation-period boundary (quarter / half /
  // year) where the tier actually settles. Tier evaluation still runs at
  // the term cadence — only the display changed. Monthly-eval and
  // multi-term ("lifetime") contracts keep plain per-month rows.
  const displayRows: TimelineRowWithVolume[] =
    primaryEval === "monthly" || primaryEval === "lifetime"
      ? rows
      : (() => {
          const out: TimelineRowWithVolume[] = []
          let bucket: TimelineRowWithVolume | null = null
          const flush = () => {
            if (bucket) out.push(bucket)
            bucket = null
          }
          for (const r of rows) {
            const key = periodKeyFor(r.month)
            if (bucket && bucket.month !== key) flush()
            out.push(r)
            const cur: TimelineRowWithVolume | null = bucket
            if (!cur) {
              bucket = { ...r, month: key, isPeriodSubtotal: true }
              continue
            }
            const better: boolean =
              r.tierAchieved > cur.tierAchieved ||
              (r.tierAchieved === cur.tierAchieved &&
                r.rebatePercent > cur.rebatePercent)
            bucket = {
              ...cur,
              spend: cur.spend + r.spend,
              // period-end running total (cumulative already resets per period)
              cumulativeSpend: r.cumulativeSpend,
              accruedAmount: cur.accruedAmount + r.accruedAmount,
              // bugs.rtfd 2026-06-13: the subtotal's growth-baseline basis is
              // the sum of the window's monthly cuts (only the period-end
              // month is non-zero, but sum to be cadence-agnostic).
              growthBaselineApplied:
                cur.growthBaselineApplied + r.growthBaselineApplied,
              volume: cur.volume + r.volume,
              tierAchieved: better ? r.tierAchieved : cur.tierAchieved,
              rebatePercent: better ? r.rebatePercent : cur.rebatePercent,
              achievedRebateType: better
                ? r.achievedRebateType
                : cur.achievedRebateType,
              achievedRebateValue: better
                ? r.achievedRebateValue
                : cur.achievedRebateValue,
              // bugs.rtfd 2026-06-13 M: the subtotal carries the period's
              // settled share — the latest month with a value wins.
              marketSharePercent:
                r.marketSharePercent ?? cur.marketSharePercent,
              // Merge by termIndex — a year subtotal must show one line per
              // term, not one line per term-month (2026-06-10).
              termContributions: ((): MultiTermTimelineRow["termContributions"] => {
                const merged = new Map<
                  number,
                  MultiTermTimelineRow["termContributions"][number]
                >(cur.termContributions.map((c) => [c.termIndex, { ...c }]))
                for (const c of r.termContributions) {
                  const prev = merged.get(c.termIndex)
                  if (prev) {
                    prev.accruedAmount += c.accruedAmount
                    if (c.tierAchieved > prev.tierAchieved) {
                      prev.tierAchieved = c.tierAchieved
                      prev.rebatePercent = c.rebatePercent
                    }
                  } else {
                    merged.set(c.termIndex, { ...c })
                  }
                }
                return Array.from(merged.values())
              })(),
            }
          }
          flush()
          return out
        })()

  // Per-term labels so the Accrual Timeline UI can render each term's
  // contribution on multi-term contracts instead of collapsing to the
  // "best" term. Without this, a contract with a spend rebate + a
  // category-scoped rebate shows only the dominant rate, which led users
  // to report "it's only pulling from the 1st one" (2026-04-23).
  const termLabels = [
    ...termsWithTiers.map((t, i) => ({
      termIndex: i,
      termName: t.termName ?? `Term ${i + 1}`,
      evaluationPeriod: t.evaluationPeriod ?? "annual",
    })),
    // 2026-06-10: overlay terms (market-share / compliance / carve-out /
    // volume rows attributed above) get their own labels so the per-term
    // breakdown names them.
    ...overlayTermLabels,
  ]

  return serialize({
    rows: displayRows,
    method,
    termLabels,
    cumulativeReset,
    isVolumeRebate,
  })
}

/**
 * Shared YYYY-MM monthly spend bucketing (normal tier-walk path + the
 * `termsWithTiers.length === 0` overlay path — bugs.rtfd 2026-06-11 A4).
 * Buckets the fetched COG rows by transaction month, applies an optional
 * category IN filter (already canonical-expanded by the caller via
 * `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` +
 * `facilityCogCategoryUniverse`), and emits a contiguous series from
 * rangeStart's month through rangeEnd's month so zero-spend months still
 * render.
 */
function buildMonthlySpendSeriesFromCogRows(
  rows: ReadonlyArray<{
    transactionDate: Date | null
    extendedPrice: Prisma.Decimal | number | null
    category?: string | null
  }>,
  categoryFilter: ReturnType<typeof buildCategoryWhereClause>,
  rangeStart: Date,
  rangeEnd: Date,
): MonthlySpend[] {
  const categoryIn = categoryFilter.category?.in ?? null
  const categorySet = categoryIn ? new Set(categoryIn) : null

  const byMonth = new Map<string, number>()
  for (const r of rows) {
    const d = r.transactionDate
    if (!d) continue
    if (categorySet && !categorySet.has(r.category ?? "")) continue
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.extendedPrice))
  }

  const series: MonthlySpend[] = []
  const cursor = new Date(
    Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1),
  )
  const lastMonth = new Date(
    Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), 1),
  )
  while (cursor <= lastMonth) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    series.push({ month: key, spend: byMonth.get(key) ?? 0 })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return series
}

/**
 * bugs.rtfd 2026-06-13 M: per-evaluation-window market share for the
 * timeline display (both the early overlay-only path and the normal walk
 * path), computed through the threshold WRITER's own exported helpers —
 * `buildThresholdEvaluationWindows` for the window grid (same clamps,
 * same anchoring) and `computePerPeriodMarketShare` for the share itself
 * (group-aware vendor union ÷ facility union across the SAME canonical
 * category variants — multi-category terms use COMBINED spend on both
 * sides, never a per-category average). Display only: writes nothing.
 *
 * The tier per window comes from the writer's same bridge —
 * `determineTier` over `spendMin`→`thresholdMin` PERCENT points (0-100,
 * the threshold-units rule) — and the rate from the achieved tier via
 * `resolveOverlayTierRate` (tier 0 → 0 → the UI's "—").
 */
type MarketShareDisplayData = {
  /** YYYY-MM → share (%) of the evaluation window the month belongs to. */
  shareByMonth: Map<string, number>
  /** One entry per evaluation window: its display end month (natural
   * period end clamped to the horizon) + share-derived tier/rate. */
  windowEnds: Array<{
    termId: string
    month: string
    share: number
    tierAchieved: number
    rebatePercent: number
  }>
}

async function computeMarketShareDisplayForContract(
  contract: _AccrualContract,
  facilityId: string,
): Promise<MarketShareDisplayData | null> {
  const msTerms = contract.terms.filter(
    (t) => t.termType === "market_share" && t.tiers.length > 0,
  )
  if (msTerms.length === 0) return null
  const vendorIds = contractVendorIds(contract)
  if (vendorIds.length === 0) return null

  const shareByMonth = new Map<string, number>()
  const windowEnds: MarketShareDisplayData["windowEnds"] = []
  for (const term of msTerms) {
    const grid = buildThresholdEvaluationWindows({
      contractEffectiveDate: contract.effectiveDate,
      contractExpirationDate: contract.expirationDate,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
      evaluationPeriod: term.evaluationPeriod ?? null,
    })
    if (!grid) continue
    // Closed windows (the writer's buckets) + the currently-running tail
    // window when it has started — its share is the to-date share (the
    // helper's COG queries are clamped at grid.end).
    const windows = [...grid.windows]
    if (
      grid.openTail &&
      grid.openTail.periodStart.getTime() <= grid.end.getTime()
    ) {
      windows.push(grid.openTail)
    }
    if (windows.length === 0) continue
    // Same category scoping the threshold dispatcher feeds the writer
    // (`recompute-accrual.ts`): explicit term categories, else the
    // contract's product category name.
    const scopedCategoryNames =
      term.appliesTo === "specific_category" &&
      Array.isArray(term.categories) &&
      term.categories.length > 0
        ? Array.from(new Set(term.categories))
        : contract.productCategory?.name
          ? [contract.productCategory.name]
          : []
    const windowShares = await computePerPeriodMarketShare({
      facilityId,
      vendorIds,
      scopedCategoryNames,
      windows,
      queryStart: grid.start,
      queryEnd: grid.end,
    })
    const thresholdTiers: RebateTier[] = term.tiers.map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName ?? null,
      thresholdMin: Number(t.spendMin ?? 0),
      thresholdMax:
        t.spendMax === null || t.spendMax === undefined
          ? null
          : Number(t.spendMax),
      // Unused for tier SELECTION; the display rate comes from
      // resolveOverlayTierRate so dollar payouts never render as %.
      rebateValue: Number(t.rebateValue ?? 0),
    }))
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]
      const share = windowShares[i]?.share ?? 0
      const achieved = determineTier(share, thresholdTiers, "EXCLUSIVE")
      const tierAchieved = achieved?.tierNumber ?? 0
      const rebatePercent = resolveOverlayTierRate(term, tierAchieved)
      const last = new Date(
        Math.min(w.periodEnd.getTime(), grid.end.getTime()),
      )
      const cursor = new Date(
        Date.UTC(
          w.periodStart.getUTCFullYear(),
          w.periodStart.getUTCMonth(),
          1,
        ),
      )
      const lastMonth = new Date(
        Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1),
      )
      let endMonthKey: string | null = null
      while (cursor <= lastMonth) {
        const key = `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, "0")}`
        // Multi-market-share contracts: later terms win on collisions —
        // the column carries one number per month.
        shareByMonth.set(key, share)
        endMonthKey = key
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
      if (endMonthKey) {
        windowEnds.push({
          termId: term.id,
          month: endMonthKey,
          share,
          tierAchieved,
          rebatePercent,
        })
      }
    }
  }
  return { shareByMonth, windowEnds }
}

/**
 * Evaluation-period bucket key for a YYYY-MM month — drives the
 * Cumulative column's reset boundaries AND the period-subtotal rows.
 * Shared by the normal walk path and the overlay-only early path (A4).
 * Cadences: monthly / quarterly / semi_annual / annual / lifetime —
 * never drop semi_annual (recurring regression class).
 */
function periodKeyForEval(
  month: string,
  evalPeriod: "monthly" | "quarterly" | "semi_annual" | "annual" | "lifetime",
): string {
  const [y, m] = month.split("-").map((n) => Number(n))
  if (evalPeriod === "monthly") return month
  if (evalPeriod === "quarterly") {
    const q = Math.floor((m - 1) / 3) + 1
    return `${y}-Q${q}`
  }
  if (evalPeriod === "semi_annual") {
    const h = m <= 6 ? 1 : 2
    return `${y}-H${h}`
  }
  if (evalPeriod === "annual") return `${y}`
  return "lifetime"
}

// Local month-key helpers duplicated from `lib/contracts/accrual.ts` —
// the originals are not exported. Keep identical UTC semantics.
function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month - 1, 1))
}

function monthKeyEndOfMonth(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month, 0))
}
