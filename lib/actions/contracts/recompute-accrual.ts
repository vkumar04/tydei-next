"use server"

/**
 * Regenerate Rebate rows for a contract from its current term +
 * tier configuration (Charles R5.21).
 *
 * Background: `getAccrualTimeline` computes accruals on-the-fly for
 * display and NEVER writes to the database, while the contract detail
 * "Rebates Earned" card reads from `prisma.rebate` rows (per the
 * CLAUDE.md "never auto-compute rebates for display" rule).
 *
 * That split means when a user edits `ContractTerm.evaluationPeriod`
 * (or any other field that changes the accrual shape), the detail card
 * continues to show the stale $0 — no Rebate rows exist under the new
 * cadence until we regenerate them.
 *
 * This action owns that regeneration. It is safe to call repeatedly:
 *
 *   1. Delete all system-generated Rebate rows for the contract. Rows
 *      are identified by the `[auto-accrual]` notes prefix so manually
 *      entered rebates (`createContractTransaction` with type=rebate)
 *      are preserved.
 *   2. Walk the same compute path `getAccrualTimeline` uses, and write
 *      one Rebate row per month with a non-zero accrual, tagging each
 *      with the `[auto-accrual]` prefix.
 *
 * Called automatically at the end of every term save — create, update,
 * delete, and tier upsert — in `lib/actions/contract-terms.ts`.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  bucketAccrualsByCadence,
  buildMonthlyAccruals,
  type EvaluationPeriod,
  type MonthlySpend,
  type MultiTermTimelineRow,
  type PaymentCadence,
  type TermAccrualConfig,
} from "@/lib/contracts/accrual"
import type {
  RebateMethodName,
  TierLike,
} from "@/lib/contracts/rebate-method"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
} from "@/lib/contracts/cog-category-filter"
import { scaleRebateValueForEngine } from "@/lib/rebates/calculate"

// The notes prefix marks rows this action owns so it can rewrite them
// safely without touching manually-entered rebate rows. Must stay a
// local (non-exported) const — `"use server"` files can only export
// async functions per the CLAUDE.md convention.
const AUTO_ACCRUAL_PREFIX = "[auto-accrual]"

export interface RecomputeAccrualResult {
  deleted: number
  inserted: number
  // Total earned across all auto-accrual rows AFTER the rewrite. The
  // caller compares this against a prior total (if they have one) to
  // report how much the number moved; the action itself does not track
  // history. Charles W1.K: surfaced so the "Recompute Earned Rebates"
  // button in the Transactions tab can toast a real $ figure instead of
  // just row counts.
  sumEarned: number
}

export async function recomputeAccrualForContract(
  contractId: string,
): Promise<RecomputeAccrualResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  // If the contract isn't visible to this facility, bail quietly — the
  // caller already validated the write. This just means we can't
  // recompute (e.g. cross-facility test fixtures).
  if (!contract) {
    return { deleted: 0, inserted: 0, sumEarned: 0 }
  }

  // Charles W1.Q — Self-heal future-dated auto-accrual rows first.
  // These are stale artifacts from seed scripts or pre-R5.26 runs that
  // wrote Rebate rows with `payPeriodEnd > today`. The main delete below
  // would catch them anyway (same notes prefix), but calling out the
  // future purge as its own step makes the invariant explicit: no
  // `[auto-accrual]` row may ever carry `payPeriodEnd > today`.
  const now = new Date()
  await prisma.rebate.deleteMany({
    where: {
      contractId,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
      payPeriodEnd: { gt: now },
      // Charles W1.W-C1: never wipe a row the user has already marked
      // collected — that stamp is the only record of money received.
      collectionDate: null,
    },
  })

  // Always wipe the previous auto-accrual rows first so a term edit
  // that shrinks the accrual window (e.g. fewer months qualify) drops
  // the now-obsolete entries. Manual rebates are preserved by the
  // `notes` prefix filter.
  //
  // Charles W1.W-C1: also preserve rows that have been collected. Once
  // the user logs a collection, the row carries `collectionDate != null`
  // and must survive future recomputes — otherwise Recompute Earned
  // Rebates would silently erase the payment-received stamp.
  const deleteResult = await prisma.rebate.deleteMany({
    where: {
      contractId,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
      collectionDate: null,
    },
  })

  // Charles R5.29: iterate ALL terms, not just terms[0]. Multi-term
  // contracts (e.g. "Qualified Annual Spend Rebate" + "Distal Extremities
  // Rebate") under-reported because only the first term's math was ever
  // summed into the ledger. We now compute each term's own accrual
  // series and sum per-month across terms before writing Rebate rows.
  const termsWithTiers = contract.terms.filter((t) => t.tiers.length > 0)
  if (termsWithTiers.length === 0) {
    return { deleted: deleteResult.count, inserted: 0, sumEarned: 0 }
  }

  // Charles W1.U-A: each term may be scoped to a specific set of product
  // categories (`ContractTerm.appliesTo === "specific_category"` with
  // `categories: ["Spine", ...]`). Pre-W1.U the engine pulled COG by
  // vendorId only and fed the vendor's entire spend through every term,
  // which over-reported rebates on narrow terms and under-reported when
  // tier thresholds needed isolated category spend.
  //
  // Strategy: query COG once over the UNION of every term's categories
  // (or unfiltered when any term is all-products), then partition the
  // rows per-term in memory and run the engine per-term with its own
  // spend series. The per-term accrual rows are then summed per month
  // into a synthetic `MultiTermTimelineRow[]` that the existing cadence
  // bucketer consumes unchanged.
  const termScopes = termsWithTiers.map((term) => ({
    appliesTo: term.appliesTo,
    categories: term.categories,
  }))
  const unionCategoryWhere = buildUnionCategoryWhereClause(termScopes)

  // Charles W1.V — scale `rebateValue` by 100 at the Prisma boundary for
  // `percent_of_spend` tiers (same convention as `getAccrualTimeline`
  // from W1.S and `computeRebateFromPrismaTiers`). Pre-fix this boundary
  // fed raw fractions (0.03) into the engine, which expects integer
  // percent (3), so every persisted Rebate row's `rebateEarned` landed
  // 100× too small. Routes through `scaleRebateValueForEngine` so the
  // unit convention is owned by a single helper. See CLAUDE.md "Rebate
  // engine units" rule.
  const termConfigs: TermAccrualConfig[] = termsWithTiers.map((term) => {
    const tiers: TierLike[] = term.tiers.map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName ?? null,
      spendMin: Number(t.spendMin),
      spendMax: t.spendMax ? Number(t.spendMax) : null,
      rebateValue: scaleRebateValueForEngine(t.rebateValue, t.rebateType),
    }))
    const method: RebateMethodName = term.rebateMethod ?? "cumulative"
    const evaluationPeriod: EvaluationPeriod =
      term.evaluationPeriod === "monthly" ||
      term.evaluationPeriod === "quarterly"
        ? term.evaluationPeriod
        : "annual"
    return {
      tiers,
      method,
      evaluationPeriod,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
    }
  })

  // Bound the accrual window by today — future months have no actuals
  // and shouldn't emit Rebate rows (those would leak into "earned"
  // aggregates that filter on payPeriodEnd <= today).
  const end = new Date(
    Math.min(new Date().getTime(), contract.expirationDate.getTime()),
  )

  // Charles R5.10/R5.12 — bucket COG spend by `transactionDate` (the
  // real purchase date), never by `createdAt` (the DB insertion time).
  // Using `createdAt` made every auto-accrual Rebate row land in the
  // single month the seed/import ran, pushing `payPeriodEnd` forward to
  // that month's end — which in turn got filtered out of the contract
  // detail "Rebates Earned" card (payPeriodEnd > today).
  //
  // Charles W1.U-A — spread `unionCategoryWhere` so the narrow set of
  // COG rows we ever need to consider is fetched in one round-trip;
  // per-term filtering happens below, in memory.
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: { gte: contract.effectiveDate, lte: end },
      ...unionCategoryWhere,
    },
    select: {
      transactionDate: true,
      extendedPrice: true,
      category: true,
    },
  })

  // Helper: build a YYYY-MM-keyed monthly spend series from a subset of
  // COG rows. We run it once per term with the term's category filter
  // applied so each term's tier math sees only the slice it is scoped to.
  const buildSeries = (
    rows: typeof cogRecords,
    categoryFilter: ReturnType<typeof buildCategoryWhereClause>,
  ): MonthlySpend[] => {
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
      Date.UTC(
        contract.effectiveDate.getUTCFullYear(),
        contract.effectiveDate.getUTCMonth(),
        1,
      ),
    )
    const lastMonth = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
    )
    while (cursor <= lastMonth) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
      series.push({ month: key, spend: byMonth.get(key) ?? 0 })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
    return series
  }

  // Per-term accrual series. We compute each term against its own
  // category-filtered spend (W1.U-A) instead of feeding one vendor-wide
  // series through `buildMultiTermMonthlyAccruals`. Shape the per-term
  // TimelineRows into a synthetic MultiTermTimelineRow[] aligned to the
  // longest series so the existing cadence bucketer can run unchanged.
  const perTermResults = termsWithTiers.map((term, idx) => {
    const termScope = { appliesTo: term.appliesTo, categories: term.categories }
    const termCategoryWhere = buildCategoryWhereClause(termScope)
    const series = buildSeries(cogRecords, termCategoryWhere)
    const rows = buildMonthlyAccruals(
      series,
      termConfigs[idx].tiers,
      termConfigs[idx].method,
      termConfigs[idx].evaluationPeriod,
    )
    return { termIndex: idx, series, rows, config: termConfigs[idx] }
  })

  // Align every term's rows on the same month index. All series share
  // the same effectiveDate→end window via `buildSeries`, so they already
  // line up — but we walk the first term's months as the canonical
  // timeline and gather each term's contribution.
  const monthsTimeline =
    perTermResults[0]?.series.map((s) => s.month) ?? []

  const multiRows: MultiTermTimelineRow[] = monthsTimeline.map((month, i) => {
    let totalSpend = 0
    let totalAccrued = 0
    let bestTier = 0
    let bestPercent = 0
    let bestContribution = -1
    const contributions: MultiTermTimelineRow["termContributions"] = []

    const monthStart = monthKeyToDate(month)
    const monthEnd = monthKeyEndOfMonth(month)

    for (const { termIndex, rows, config, series } of perTermResults) {
      // Per-term effective-window gate (mirrors the gate in
      // buildMultiTermMonthlyAccruals — terms outside their window don't
      // contribute to this month).
      const startOk =
        config.effectiveStart == null || config.effectiveStart <= monthEnd
      const endOk =
        config.effectiveEnd == null || config.effectiveEnd >= monthStart
      if (!startOk || !endOk) continue

      const row = rows[i]
      const entry = series[i]
      if (!row || !entry) continue

      // spend displayed on the bucket = union of contributing terms'
      // per-term spend for the month (dedup via max vs sum is a choice;
      // we sum here because different category terms see disjoint slices).
      totalSpend += entry.spend

      if (row.accruedAmount <= 0) continue
      totalAccrued += row.accruedAmount
      contributions.push({
        termIndex,
        accruedAmount: row.accruedAmount,
        tierAchieved: row.tierAchieved,
        rebatePercent: row.rebatePercent,
      })
      if (row.accruedAmount > bestContribution) {
        bestContribution = row.accruedAmount
        bestTier = row.tierAchieved
        bestPercent = row.rebatePercent
      }
    }

    return {
      month,
      spend: totalSpend,
      // cumulative across terms is a fuzzy concept when terms are
      // category-scoped; the bucketer ignores this field for persistence
      // (only `spend` and `accruedAmount` are written), so keeping the
      // per-month sum here is safe.
      cumulativeSpend: totalSpend,
      accruedAmount: totalAccrued,
      tierAchieved: bestTier,
      rebatePercent: bestPercent,
      termContributions: contributions,
    }
  })

  // Charles W1.O: collapse monthly accrual rows into buckets sized by
  // the primary term's `paymentCadence`. Quarterly contracts should
  // write ONE Rebate row per calendar quarter (spanning ~90 days), not
  // three monthly rows (~30 days each). If cadence is null/unknown on
  // all terms, fall back to monthly so existing contracts keep today's
  // behavior. Mixed-cadence contracts use the FIRST term's cadence —
  // consistent with the rest of the codebase's "primary term" convention.
  // Charles W1.T — paymentCadence is contract-level now; read from
  // Contract directly. Fall back to monthly when the column is unset
  // (non-tie-in contracts or tie-in contracts without capital entered).
  const primaryCadence: PaymentCadence =
    (contract.paymentCadence as PaymentCadence | null | undefined) ??
    "monthly"
  const buckets = bucketAccrualsByCadence(multiRows, primaryCadence)

  // Charles W1.W-C1: preserved collected rows from a prior accrual run
  // now live in the Rebate table with `collectionDate != null`. Skip
  // any bucket whose period already has such a row — re-inserting would
  // double-count the earned accrual. The collected row already carries
  // the accrual (rebateEarned is preserved in-place when the user logs
  // a collection), so we trust it as the final ledger entry for that
  // period.
  const preservedCollected = await prisma.rebate.findMany({
    where: {
      contractId,
      collectionDate: { not: null },
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
    select: { payPeriodStart: true, payPeriodEnd: true },
  })
  const preservedKeys = new Set(
    preservedCollected.map(
      (r) =>
        `${new Date(r.payPeriodStart).toISOString()}|${new Date(r.payPeriodEnd).toISOString()}`,
    ),
  )

  // Only persist buckets with non-zero accrual — a monthly-eval contract
  // whose tier 1 spendMin was missed in month N shouldn't pollute the
  // Rebate table with zeros. Aggregations that SUM over Rebate rows
  // treat missing periods as $0 anyway.
  const toInsert = buckets
    .filter((b) => {
      const key = `${new Date(b.periodStart).toISOString()}|${new Date(b.periodEnd).toISOString()}`
      return !preservedKeys.has(key)
    })
    .map((b) => {
      // Charles R5.29: notes string reflects whether the row is a
      // single-term or multi-term aggregate. Rebate has no termId column
      // (see spec); one row per bucket holds the aggregated earned.
      const noteBody =
        b.termCount > 1
          ? `${b.termCount} terms combined on $${b.totalSpend.toFixed(2)} (${b.label})`
          : `${b.label} · tier ${b.tierAchieved} @ ${b.rebatePercent}% on $${b.totalSpend.toFixed(2)}`
      return {
        contractId,
        facilityId: facility.id,
        rebateEarned: b.rebateEarned,
        rebateCollected: 0,
        payPeriodStart: b.periodStart,
        payPeriodEnd: b.periodEnd,
        collectionDate: null,
        notes: `${AUTO_ACCRUAL_PREFIX} ${noteBody}`,
      }
    })

  if (toInsert.length === 0) {
    return { deleted: deleteResult.count, inserted: 0, sumEarned: 0 }
  }

  const createResult = await prisma.rebate.createMany({ data: toInsert })

  // Re-read the auto-accrual total so the caller can render a real $
  // figure in a toast. Filtering on the notes prefix matches the same
  // set we delete/re-create above.
  const sumAgg = await prisma.rebate.aggregate({
    where: {
      contractId,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
    _sum: { rebateEarned: true },
  })
  const sumEarned = Number(sumAgg._sum.rebateEarned ?? 0)

  return {
    deleted: deleteResult.count,
    inserted: createResult.count,
    sumEarned,
  }
}

// Local month-key helpers duplicated from `lib/contracts/accrual.ts` —
// the originals are not exported. Keep identical semantics (UTC-safe).
function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month - 1, 1))
}

function monthKeyEndOfMonth(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month, 0))
}
