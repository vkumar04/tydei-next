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

const AUTO_THRESHOLD_PREFIX = "[auto-threshold-accrual]"

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

  const today = new Date()
  const start = new Date(
    Math.max(
      input.contractEffectiveDate.getTime(),
      term.effectiveStart?.getTime() ?? -Infinity,
    ),
  )
  // Push date-only bounds to end-of-day so a period whose periodEnd
  // is the same calendar day as the contract/term expiration still
  // counts as in-window. Without this an annual contract from
  // 2025-01-01 through 2025-12-31 emits 0 buckets because
  // periodEnd = 2025-12-31T23:59:59.999 > end = 2025-12-31T00:00:00.
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
      term.effectiveEnd ? endOfDay(term.effectiveEnd).getTime() : Infinity,
    ),
  )
  if (end.getTime() <= start.getTime()) {
    return { inserted: 0, sumEarned: 0 }
  }

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
  // the contract window.
  const width = widthMonths(term.evaluationPeriod)
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    periodPayment: number
    spendInScope: number
  }
  const results: BucketResult[] = []
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    const periodEnd = new Date(next.getTime() - 1)
    if (periodEnd.getTime() > end.getTime()) break
    results.push({
      periodStart: cursor,
      periodEnd,
      periodPayment: flatPerPeriodPayment,
      spendInScope: 0,
    })
    cursor = next
  }

  // Per-period evaluation for market_share terms (2026-06-09): compute each
  // window's share from COG and qualify ITS tier, instead of stamping the
  // current scalar onto history. Two whole-window queries (vendor-set
  // numerator + facility-wide denominator), partitioned in memory per
  // bucket — same single-query pattern the old percent branch used.
  const perBucketShare = new Map<
    number,
    { share: number; tierNumber: number }
  >()
  if (isPerPeriodMarketShare && results.length > 0) {
    const categoryFilter =
      term.appliesTo === "specific_category" &&
      Array.isArray(term.categories) &&
      term.categories.length > 0
        ? { category: { in: Array.from(new Set(term.categories)) } }
        : term.categoryName
          ? { category: term.categoryName }
          : {}
    const vendorIdSet = term.vendorIds ?? (term.vendorId ? [term.vendorId] : [])
    const [vendorRows, facilityRows] = await Promise.all([
      prisma.cOGRecord.findMany({
        where: {
          facilityId,
          // #2: group-aware — spans the contract's full vendor set.
          vendorId: { in: vendorIdSet },
          transactionDate: { gte: start, lte: end },
          ...categoryFilter,
        },
        select: { transactionDate: true, extendedPrice: true },
      }),
      prisma.cOGRecord.findMany({
        where: {
          facilityId,
          transactionDate: { gte: start, lte: end },
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
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const vendorSpend = sumInWindow(vendorRows, r.periodStart, r.periodEnd)
      const facilitySpend = sumInWindow(
        facilityRows,
        r.periodStart,
        r.periodEnd,
      )
      const windowShare =
        facilitySpend > 0 ? (vendorSpend / facilitySpend) * 100 : 0
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
    // scalar percent-of-spend branch — Bug #21 math.
    const categoryFilter =
      term.appliesTo === "specific_category" &&
      Array.isArray(term.categories) &&
      term.categories.length > 0
        ? { category: { in: Array.from(new Set(term.categories)) } }
        : term.categoryName
          ? { category: term.categoryName }
          : {}
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
