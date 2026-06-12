// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract.

/**
 * Threshold-based rebate accrual writer (Charles 2026-04-25).
 *
 * Generic bridge for term types that pay a flat tier rebate when a
 * contract-level metric crosses a threshold. Today this covers:
 *   - `compliance_rebate` — metric is `Contract.complianceRate` (%)
 *   - `market_share`     — metric is `Contract.currentMarketShare` (%)
 *
 * Both share the same shape: tier ladder where `spendMin` is the
 * threshold percent (0-100) and `rebateValue` is the flat dollar
 * amount paid for the evaluation period when that tier is achieved.
 * Cumulative method only — marginal doesn't make sense for a "you
 * either hit the threshold or you don't" payout.
 *
 * v1 scope:
 *   - Reads the contract-level metric value as it exists right now.
 *     Future v2: snapshot the metric per evaluation period from a
 *     compliance / market-share history table once those exist.
 *   - One Rebate row per evaluation period in the contract window.
 *   - Idempotent via `[auto-threshold-accrual] term:<id>` notes prefix.
 */
import { prisma } from "@/lib/db"
import type { RebateTier } from "@/lib/rebates/engine/types"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"
import { expandCategoriesToCogVariants } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"

// bugs.rtfd 2026-06-12 R1: prefix now lives in the shared family
// module so recomputeAccrualForContract's upfront wipe can cover
// every writer's rows (term-type edits left the prior writer's
// rows immortal — volume math 38,775 + stale 26,751 = 65,526).
import { AUTO_THRESHOLD_PREFIX } from "@/lib/contracts/recompute/auto-accrual-prefixes"

export type ThresholdMetric = "complianceRate" | "currentMarketShare"

interface ThresholdRebateTermLike {
  id: string
  evaluationPeriod: string | null
  effectiveStart: Date | null
  effectiveEnd: Date | null
  /**
   * Bug #21 (2026-05-11, Vick): market_share + percent_of_spend
   * needs to fall back to per-period vendor spend × percent, not
   * the flat-payout shape compliance uses. The dispatcher passes
   * termType + the contract's vendorId + category name through so
   * the percent-of-spend branch below has everything it needs.
   */
  termType?: string | null
  vendorId?: string | null
  /** #2: full vendor set for grouped contracts; falls back to [vendorId]. */
  vendorIds?: string[] | null
  categoryName?: string | null
  appliesTo?: string | null
  categories?: string[]
  tiers: Array<{
    tierNumber: number
    tierName: string | null
    spendMin: unknown
    spendMax: unknown
    rebateValue: unknown
    rebateType?: string | null
  }>
}

/**
 * Charles 2026-04-25 audit re-pass F2 — legacy compatibility.
 *
 * The threshold engine pays a flat dollar amount per evaluation
 * period when the metric crosses a tier threshold. Newly-created
 * contracts default the tier's rebateType to `fixed_rebate` so
 * `tier.rebateValue` is the literal dollar amount.
 *
 * Older contracts (or hydration paths that defaulted to
 * `percent_of_spend`) store rebateValue as a fraction (0.02 = 2%).
 * Reading 0.02 as a flat payout would pay $0.02 per period instead
 * of the intended dollar amount. Until those rows are backfilled,
 * we treat percent_of_spend tiers in this engine as percent-points
 * × 100 (so 0.02 → $2, matching the boundary scaling the spend
 * engine performs). Logged once per contract so the backfill is
 * traceable.
 *
 * NEW contracts should always use fixed_rebate for compliance /
 * market_share term types — see createEmptyTier.
 */
function payoutForTier(
  tier: {
    rebateValue: unknown
    rebateType?: string | null
  },
  contractId: string,
  warned: Set<string>,
): number {
  const raw = Number(tier.rebateValue ?? 0)
  if (tier.rebateType === "fixed_rebate") {
    return raw
  }
  if (tier.rebateType === "percent_of_spend") {
    if (!warned.has(contractId)) {
      console.warn(
        `[recompute-threshold-accrual] contract ${contractId}: tier.rebateType=percent_of_spend on a threshold term — interpreting tier.rebateValue (${raw}) as percent-points × 100 for legacy compatibility. Backfill to fixed_rebate when possible.`,
      )
      warned.add(contractId)
    }
    return raw * 100
  }
  // Unknown / null rebateType — assume the value is already the
  // intended dollar payout. Same conservative behavior as before
  // this fix.
  return raw
}

const LEGACY_PAYOUT_WARNED = new Set<string>()

function widthMonths(eval_: string | null): number {
  switch (eval_) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "semi_annual":
      return 6
    case "annual":
    default:
      return 12
  }
}

function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}

export interface ThresholdEvaluationWindow {
  periodStart: Date
  periodEnd: Date
}

/**
 * bugs.rtfd 2026-06-13 M: the writer's evaluation-window grid, extracted
 * verbatim so `getAccrualTimeline` can render a market-share term's
 * windows (share + tier + $0 accrual) even when the writer persisted no
 * rows — a below-lowest-threshold window has `periodPayment = 0` and the
 * writer's `periodPayment <= 0` gate skips it entirely, which made the
 * term indistinguishable from broken on the timeline.
 *
 * Behavior is byte-identical to the inline code this replaces:
 *   - start = max(contract effective, term effectiveStart)
 *   - end   = min(today, endOfDay(contract expiry), endOfDay(term end))
 *   - grid anchored at the first of start's month, stepping
 *     `widthMonths(evaluationPeriod)`, 200-iteration guard
 *   - `windows` holds only CLOSED windows (periodEnd <= end) — exactly
 *     the buckets the writer emits rows for
 *   - `openTail` is the first window whose natural periodEnd exceeds
 *     `end` (where the writer's loop breaks) — display-only callers can
 *     render its to-date share; the writer ignores it.
 * Returns null when the clamped window is empty (writer's
 * `end <= start` early return).
 */
export function buildThresholdEvaluationWindows(input: {
  contractEffectiveDate: Date
  contractExpirationDate: Date
  effectiveStart: Date | null
  effectiveEnd: Date | null
  evaluationPeriod: string | null
  today?: Date
}): {
  start: Date
  end: Date
  windows: ThresholdEvaluationWindow[]
  openTail: ThresholdEvaluationWindow | null
} | null {
  const today = input.today ?? new Date()
  const start = new Date(
    Math.max(
      input.contractEffectiveDate.getTime(),
      input.effectiveStart?.getTime() ?? -Infinity,
    ),
  )
  // Push date-only bounds to end-of-day so a period whose periodEnd
  // is the same calendar day as the contract/term expiration still
  // counts as in-window (see the original writer comment).
  const endOfDay = (d: Date) =>
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    )
  const end = new Date(
    Math.min(
      today.getTime(),
      endOfDay(input.contractExpirationDate).getTime(),
      input.effectiveEnd ? endOfDay(input.effectiveEnd).getTime() : Infinity,
    ),
  )
  if (end.getTime() <= start.getTime()) return null

  const width = widthMonths(input.evaluationPeriod)
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  const windows: ThresholdEvaluationWindow[] = []
  let openTail: ThresholdEvaluationWindow | null = null
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    const periodEnd = new Date(next.getTime() - 1)
    if (periodEnd.getTime() > end.getTime()) {
      // The writer breaks here — this window is unclosed/unpersisted.
      openTail = { periodStart: cursor, periodEnd }
      break
    }
    windows.push({ periodStart: cursor, periodEnd })
    cursor = next
  }
  return { start, end, windows, openTail }
}

/**
 * Canonical per-period market-share computation (bugs.rtfd 2026-06-13 M).
 *
 * Extracted from `recomputeThresholdAccrualForTerm`'s per-period branch
 * (2026-06-09 fix) so the writer AND `getAccrualTimeline`'s display
 * overlay compute the share through ONE code path — the drift class this
 * repo fights. Behavior is byte-identical to the inline code:
 *   - one vendor-set numerator query + one facility-wide denominator
 *     query, both scoped to the same canonical category union
 *     (`expandCategoriesToCogVariants` over the facility's COG category
 *     universe — never a raw case-sensitive `in`)
 *   - multi-category terms use the COMBINED union spend on both sides
 *     (total vendor spend across all scoped categories ÷ total facility
 *     spend across the same union — never a per-category average and
 *     never just the first category)
 *   - in-memory partition of the fetched rows per evaluation window.
 *
 * `queryStart` / `queryEnd` are the writer's gte/lte clamps (its `start`
 * / `end`); pass `buildThresholdEvaluationWindows(...).start/.end` so
 * rows before the term's clamped start don't leak into the first
 * window's sums. Defaults to the windows' min/max when omitted.
 */
export async function computePerPeriodMarketShare(input: {
  facilityId: string
  vendorIds: string[]
  scopedCategoryNames: string[]
  windows: ThresholdEvaluationWindow[]
  queryStart?: Date
  queryEnd?: Date
}): Promise<Array<{ share: number; vendorSpend: number; marketSpend: number }>> {
  const { facilityId, vendorIds, scopedCategoryNames, windows } = input
  if (windows.length === 0) return []
  const queryStart =
    input.queryStart ??
    new Date(Math.min(...windows.map((w) => w.periodStart.getTime())))
  const queryEnd =
    input.queryEnd ??
    new Date(Math.max(...windows.map((w) => w.periodEnd.getTime())))

  const categoryFilter = await buildScopedCategoryFilter(
    facilityId,
    scopedCategoryNames,
  )
  const [vendorRows, facilityRows] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: {
        facilityId,
        // #2: group-aware — spans the contract's full vendor set.
        vendorId: { in: vendorIds },
        transactionDate: { gte: queryStart, lte: queryEnd },
        ...categoryFilter,
      },
      select: { transactionDate: true, extendedPrice: true },
    }),
    prisma.cOGRecord.findMany({
      where: {
        facilityId,
        transactionDate: { gte: queryStart, lte: queryEnd },
        ...categoryFilter,
      },
      select: { transactionDate: true, extendedPrice: true },
    }),
  ])
  const sumInWindow = (
    rows: Array<{ transactionDate: Date; extendedPrice: unknown }>,
    ps: Date,
    pe: Date,
  ): number => {
    let s = 0
    for (const row of rows) {
      const t = row.transactionDate.getTime()
      if (t < ps.getTime() || t > pe.getTime()) continue
      s += row.extendedPrice == null ? 0 : Number(row.extendedPrice)
    }
    return s
  }
  return windows.map((w) => {
    const vendorSpend = sumInWindow(vendorRows, w.periodStart, w.periodEnd)
    const marketSpend = sumInWindow(facilityRows, w.periodStart, w.periodEnd)
    return {
      share: marketSpend > 0 ? (vendorSpend / marketSpend) * 100 : 0,
      vendorSpend,
      marketSpend,
    }
  })
}

/**
 * Canonical category scoping for the threshold writer's COG queries
 * (2026-06-10 fix — was a raw case-sensitive `in`, see the invariants
 * table). Shared by `computePerPeriodMarketShare` and the legacy scalar
 * percent-of-spend fallback below.
 */
async function buildScopedCategoryFilter(
  facilityId: string,
  scopedCategoryNames: string[],
): Promise<Record<string, never> | { category: { in: string[] } }> {
  if (scopedCategoryNames.length === 0) return {}
  const universe = await facilityCogCategoryUniverse(facilityId)
  return {
    category: {
      in: expandCategoriesToCogVariants(scopedCategoryNames, universe),
    },
  }
}

export async function recomputeThresholdAccrualForTerm(input: {
  contractId: string
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  metric: ThresholdMetric
  metricValue: number | null
  /**
   * Bug #16 (2026-05-24): when the parent contract is tie-in, every
   * auto-accrual row is system-stamped with collectionDate = periodEnd
   * (no user-collect workflow exists for tie-in). Set this true so the
   * delete filter wipes ALL auto-accrual rows for this term — not just
   * uncollected ones. Without this, Recompute is non-idempotent.
   */
  isTieIn?: boolean
  term: ThresholdRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, facilityId, term, isTieIn } = input

  // Resolve the metric value used for tier qualification.
  //
  // Bug 2026-06-08 ("market share needs 0% to get a rebate and nothing is
  // coming up"): a `market_share` tier whose threshold is 0% means "always
  // qualifies." But `currentMarketShare` is frequently null (not set / no
  // categorized COG to derive from), and a null metric early-returned with
  // zero rows — so the 0%-threshold tier never paid. For market_share,
  // treat null as 0% so the 0-threshold tier qualifies; the
  // `periodPayment <= 0` guard below still suppresses $0 fleets (a
  // percent_of_spend tier with no in-scope spend stays $0).
  //
  // complianceRate keeps null → no qualification: a null compliance rate
  // means "not tracked yet," not "0% compliant," and writing flat payouts
  // there would be wrong (locked by recompute-threshold-accrual.test.ts).
  const metricValue =
    input.metricValue != null
      ? input.metricValue
      : input.metric === "currentMarketShare"
        ? 0
        : null

  if (metricValue == null || metricValue < 0) {
    return { inserted: 0, sumEarned: 0 }
  }

  // bugs.rtfd 2026-06-13 M: clamp + window grid now live in
  // `buildThresholdEvaluationWindows` (shared with the timeline's
  // market-share display overlay). Same dates, same guard.
  const grid = buildThresholdEvaluationWindows({
    contractEffectiveDate: input.contractEffectiveDate,
    contractExpirationDate: input.contractExpirationDate,
    effectiveStart: term.effectiveStart,
    effectiveEnd: term.effectiveEnd,
    evaluationPeriod: term.evaluationPeriod,
  })
  if (!grid) {
    return { inserted: 0, sumEarned: 0 }
  }
  const { start, end } = grid

  // TODO (Charles canonical engine wiring 2026-05-05): the canonical
  // `calculateRebate(SPEND_REBATE)` engine evaluates a single ladder
  // and returns one tierResult; the threshold writer instead emits
  // one Rebate row per evaluation period at a flat per-period payout
  // (`achievedTier.rebateValue`). The engine has no per-period
  // emission concept and would treat `metricValue` as dollars rather
  // than percent. Wiring requires either an engine result-shape
  // change or a thin per-period adapter. Skipped per "DO NOT change
  // engine math; just call it." Audit gap #1.
  //
  // UNITS (audit-confirmed 2026-04-25): both `metricValue`
  // (Contract.complianceRate / currentMarketShare, schema
  // `Decimal(5,2)`) and tier `spendMin` are stored as percent points
  // (0-100), the same shape the form's `<Input min=0 max=100>` writes.
  // No fraction↔percent conversion is needed — `determineTier` compares
  // `metricValue` directly against `thresholdMin`. Locked by
  // `lib/actions/contracts/__tests__/threshold-units.test.ts`.
  //
  // Tier ladder: spendMin is the threshold percent (0-100);
  // rebateValue is the flat dollar payment when that tier is achieved.
  // payoutForTier handles legacy rebateType=percent_of_spend rows that
  // store the value as a fraction — see helper docs above.
  const tiers: RebateTier[] = term.tiers
    .map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName,
      thresholdMin: Number(t.spendMin ?? 0),
      thresholdMax:
        t.spendMax === null || t.spendMax === undefined
          ? null
          : Number(t.spendMax),
      rebateValue: payoutForTier(t, contractId, LEGACY_PAYOUT_WARNED),
    }))
    .sort((a, b) => a.thresholdMin - b.thresholdMin)
  if (tiers.length === 0) return { inserted: 0, sumEarned: 0 }

  // 2026-06-09 (Charles "I think it is taking the last 12 month spend rate
  // and applying that to all times for accrual" — exactly right): tier
  // qualification previously ran ONCE on the contract-level scalar
  // (Contract.currentMarketShare — a single trailing snapshot) and the
  // resulting payment applied to EVERY historical evaluation period. A
  // contract that only recently reached a tier got credited that tier's
  // payout for all past periods (and vice versa). For market_share terms
  // the share is now computed PER EVALUATION WINDOW from COG (vendor-set
  // spend ÷ facility total spend within the window, category-scoped) and
  // each window's tier qualifies independently. complianceRate keeps the
  // scalar path — there is no per-period compliance history yet.
  const isPerPeriodMarketShare =
    input.metric === "currentMarketShare" &&
    term.termType === "market_share" &&
    (term.vendorIds?.length || term.vendorId)

  const achieved = determineTier(metricValue, tiers, "EXCLUSIVE")
  const flatPerPeriodPayment = achieved ? achieved.rebateValue : 0

  // Bug #21: market_share + percent_of_spend pays a percent of the
  // contract's in-scope vendor spend during the period, NOT a flat
  // dollar amount. (For the per-period path the achieved tier is
  // re-determined per window below; this scalar branch remains for
  // compliance and as the fallback when vendor info is missing.)
  const achievedRawTier = achieved
    ? term.tiers.find((t) => t.tierNumber === achieved.tierNumber)
    : null
  const isMarketSharePercentOfSpend =
    term.termType === "market_share" &&
    achievedRawTier?.rebateType === "percent_of_spend"
  const percentFraction = isMarketSharePercentOfSpend
    ? Number(achievedRawTier?.rebateValue ?? 0)
    : 0

  // Bucket by evaluation period — one row per closed period inside
  // the contract window (grid extracted to
  // `buildThresholdEvaluationWindows`, bugs.rtfd 2026-06-13 M).
  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    periodPayment: number
    spendInScope: number
  }
  const results: BucketResult[] = grid.windows.map((w) => ({
    periodStart: w.periodStart,
    periodEnd: w.periodEnd,
    periodPayment: flatPerPeriodPayment,
    spendInScope: 0,
  }))

  // Per-period evaluation for market_share terms (2026-06-09): compute each
  // window's share from COG and qualify ITS tier, instead of stamping the
  // current scalar onto history. Two whole-window queries (vendor-set
  // numerator + facility-wide denominator), partitioned in memory per
  // bucket — same single-query pattern the old percent branch used.
  // 2026-06-10 (Charles "market share is calculating 2% rebate for market
  // share when it should be at 10 ... the other term is not calculating
  // still"): the category filter previously used the RAW stored names in a
  // case-SENSITIVE Prisma `in` — the invariant-table violation class. A term
  // scoped to "Ortho-Extremity" matched zero COG rows stored as variants, so
  // the window share computed 0% → tier 0 → $0 rows, while the tier panel
  // (which canonicalizes) showed 70.5% → tier 2. Expand through the
  // facility's COG category universe so every canonical variant counts.
  const scopedCategoryNames =
    term.appliesTo === "specific_category" &&
    Array.isArray(term.categories) &&
    term.categories.length > 0
      ? Array.from(new Set(term.categories))
      : term.categoryName
        ? [term.categoryName]
        : []

  const perBucketShare = new Map<
    number,
    { share: number; tierNumber: number }
  >()
  if (isPerPeriodMarketShare && results.length > 0) {
    // bugs.rtfd 2026-06-13 M: the two-query union + per-window partition
    // now lives in `computePerPeriodMarketShare` (shared with the
    // timeline display path). Same queries, same clamps, same math.
    const vendorIdSet = term.vendorIds ?? (term.vendorId ? [term.vendorId] : [])
    const windowShares = await computePerPeriodMarketShare({
      facilityId,
      vendorIds: vendorIdSet,
      scopedCategoryNames,
      windows: results.map((r) => ({
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
      })),
      queryStart: start,
      queryEnd: end,
    })
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const { share: windowShare, vendorSpend } = windowShares[i]
      const windowAchieved = determineTier(windowShare, tiers, "EXCLUSIVE")
      perBucketShare.set(i, {
        share: windowShare,
        tierNumber: windowAchieved?.tierNumber ?? 0,
      })
      if (!windowAchieved) {
        r.spendInScope = vendorSpend
        r.periodPayment = 0
        continue
      }
      const windowRawTier = term.tiers.find(
        (t) => t.tierNumber === windowAchieved.tierNumber,
      )
      r.spendInScope = vendorSpend
      r.periodPayment =
        windowRawTier?.rebateType === "percent_of_spend"
          ? vendorSpend * Number(windowRawTier.rebateValue ?? 0)
          : windowAchieved.rebateValue
    }
  } else if (isMarketSharePercentOfSpend && term.vendorId && results.length > 0) {
    // Fallback (vendor info missing from the per-period path): the legacy
    // scalar percent-of-spend branch — Bug #21 math. Same canonical
    // category expansion as the per-period path (2026-06-10).
    const categoryFilter = await buildScopedCategoryFilter(
      facilityId,
      scopedCategoryNames,
    )
    const cogRows = await prisma.cOGRecord.findMany({
      where: {
        facilityId,
        vendorId: { in: term.vendorIds ?? (term.vendorId ? [term.vendorId] : []) },
        transactionDate: { gte: start, lte: end },
        ...categoryFilter,
      },
      select: { transactionDate: true, extendedPrice: true },
    })
    for (const r of results) {
      let spendSum = 0
      for (const row of cogRows) {
        const t = row.transactionDate.getTime()
        if (t < r.periodStart.getTime() || t > r.periodEnd.getTime()) continue
        spendSum += row.extendedPrice == null ? 0 : Number(row.extendedPrice)
      }
      r.spendInScope = spendSum
      r.periodPayment = spendSum * percentFraction
    }
  }

  // Idempotent persist
  const termPrefix = `${AUTO_THRESHOLD_PREFIX} term:${term.id}`
  await prisma.rebate.deleteMany({
    where: {
      contractId,
      notes: { startsWith: termPrefix },
      // Bug #16: tie-in contracts auto-stamp collectionDate, so the
      // collectionDate=null gate would never match. Drop the gate when
      // the parent contract is tie-in.
      ...(isTieIn ? {} : { collectionDate: null }),
    },
  })

  const toInsert: Array<{
    contractId: string
    facilityId: string
    rebateEarned: number
    rebateCollected: number
    payPeriodStart: Date
    payPeriodEnd: Date
    collectionDate: Date | null
    notes: string
  }> = []
  let totalEarned = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.periodPayment <= 0) continue
    totalEarned += r.periodPayment
    // 2026-06-09: per-period rows note THIS window's share + tier (was the
    // single scalar stamped on every row — "not showing the rate").
    const windowInfo = perBucketShare.get(i)
    const noteMetric = windowInfo
      ? `${input.metric}=${windowInfo.share.toFixed(1)}% (period) · tier ${windowInfo.tierNumber}`
      : `${input.metric}=${metricValue.toFixed(1)}% · tier ${achieved?.tierNumber ?? 0}`
    toInsert.push({
      contractId,
      facilityId,
      rebateEarned: r.periodPayment,
      // See carve-out.ts:248 — tie-in auto-stamps collectionDate at
      // accrual so the rebate flows into "applied to capital".
      rebateCollected: isTieIn ? r.periodPayment : 0,
      payPeriodStart: r.periodStart,
      payPeriodEnd: r.periodEnd,
      collectionDate: isTieIn ? r.periodEnd : null,
      notes:
        isMarketSharePercentOfSpend || windowInfo
          ? `${termPrefix} · ${noteMetric} · spend=$${r.spendInScope.toFixed(2)} → $${r.periodPayment.toFixed(2)}`
          : `${termPrefix} · ${noteMetric} · $${r.periodPayment.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return {
    inserted: toInsert.length,
    sumEarned: totalEarned,
  }
}
