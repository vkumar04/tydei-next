import type { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/db"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { computeRebateFromPrismaTiers, DEFAULT_COLLECTION_RATE } from "@/lib/rebates/calculate"

export const PERIODS_CONTRACT_SELECT = {
  id: true,
  vendorId: true,
  additionalVendorIds: true,
  facilityId: true,
  effectiveDate: true,
  expirationDate: true,
  // Bug 12 (2026-04-23) — the synthetic-period fallback was
  // vendor-wide, so two contracts with the same vendor + overlapping
  // windows rendered identical period sets. Pulling every term's
  // scope here lets us narrow the COG query to only categories the
  // contract's terms actually cover.
  terms: {
    select: {
      evaluationPeriod: true,
      appliesTo: true,
      categories: true,
      tiers: { orderBy: { tierNumber: "asc" as const } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const

export type PeriodsContract = Prisma.ContractGetPayload<{
  select: typeof PERIODS_CONTRACT_SELECT
}>

/**
 * Synthetic-period fallback, extracted from `_buildContractPeriods` so the
 * facility Reports surface (`getReportData`) can reuse the exact same monthly
 * COG-derived periods the vendor / Transactions surfaces already render when
 * a contract has zero persisted `ContractPeriod` rows.
 *
 * Returns the raw synthetic period objects (Dates NOT yet serialized) in
 * descending `periodStart` order, mirroring the persisted branch's ordering.
 * Callers are responsible for `serialize()` (the original `_buildContractPeriods`
 * does so; `getReportData` maps the fields itself).
 */
export async function computeSyntheticContractPeriods(
  contract: PeriodsContract,
  facilityId: string,
  // 2026-06-18 perf audit: callers looping over many contracts (Reports Hub,
  // vendor reports) should fetch the facility COG-category universe ONCE and
  // pass it in — it's facility-scoped and identical across contracts, so
  // re-fetching per contract was an N× full-COG groupBy. Omit for
  // single-contract callers (it falls back to fetching internally).
  precomputedCogUniverse?: string[],
) {
  // ── Fallback: compute monthly periods from COG matched to this
  // vendor at this facility, bounded by the contract's effective window
  // AND the union of category scopes the contract's terms cover.
  // Pre-fix (Bug 12) this was vendor-wide which produced identical
  // periods across sibling contracts. Uses the same helper the
  // contracts-list and accrual-timeline rely on so the scope is
  // canonical.
  const { buildUnionCategoryWhereClause } = await import(
    "@/lib/contracts/cog-category-filter"
  )
  const termScopes = contract.terms.map((t) => ({
    appliesTo: t.appliesTo,
    categories: t.categories,
  }))
  // 2026-06-08: expand to drifted COG category variants (see cog-category-filter).
  let cogUniverse = precomputedCogUniverse
  if (cogUniverse === undefined) {
    const { facilityCogCategoryUniverse } = await import(
      "@/lib/contracts/cog-category-universe"
    )
    cogUniverse = await facilityCogCategoryUniverse(facilityId)
  }
  const unionCategoryWhere = buildUnionCategoryWhereClause(
    termScopes,
    cogUniverse,
  )
  const cogRows = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      // 2026-06-09 audit: group-aware vendor set (recurring drift class).
      vendorId: { in: contractVendorIds(contract) },
      transactionDate: {
        gte: new Date(contract.effectiveDate),
        lte: new Date(contract.expirationDate),
      },
      ...unionCategoryWhere,
    },
    select: { transactionDate: true, extendedPrice: true },
  })

  if (cogRows.length === 0) return []

  // Bucket by YYYY-MM
  const monthBuckets = new Map<string, { start: Date; end: Date; spend: number }>()
  for (const row of cogRows) {
    if (!row.transactionDate) continue
    const d = new Date(row.transactionDate)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    const existing = monthBuckets.get(key)
    if (existing) {
      existing.spend += Number(row.extendedPrice ?? 0)
    } else {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      monthBuckets.set(key, {
        start,
        end,
        spend: Number(row.extendedPrice ?? 0),
      })
    }
  }

  // Apply the PRIMARY (first) term's tier structure for the tier-badge
  // column on the synthetic period rows. Charles R5.29 note: we
  // intentionally pick a single term here because the tierAchieved
  // column represents "which tier did this month land in" on the
  // Performance tab — it's a badge, not a summable metric. The per-
  // month `totalSpend` is term-agnostic (raw COG), and true multi-term
  // rebate aggregation happens through persisted Rebate rows written
  // by `recomputeAccrualForContract`, which DOES iterate all terms.
  const tiers = contract.terms[0]?.tiers ?? []
  // Charles R4.6: honor `evaluationPeriod` — monthly-eval contracts
  // qualify each month's tier from THAT month's spend, not a running
  // cumulative annual total. Otherwise the ladder's "annual" spendMins
  // are never reached by a single month.
  const evaluationPeriod = contract.terms[0]?.evaluationPeriod ?? "annual"
  const sortedKeys = Array.from(monthBuckets.keys()).sort()
  let cumulative = 0
  const synthetic = sortedKeys.map((key, idx) => {
    const bucket = monthBuckets.get(key)!
    cumulative += bucket.spend

    // Pick the tier-qualification denominator based on evaluationPeriod.
    // Charles R4.6: monthly-eval contracts should qualify on the month's
    // own spend, not cumulative year-to-date, otherwise tiers whose
    // spendMin was sized for annual totals never trigger.
    const tierSpend =
      evaluationPeriod === "monthly" ? bucket.spend : cumulative
    // Charles R5.7: use the facade's `rebateEarned` directly instead of
    // re-deriving it from `rebatePercent`. The facade is rebateType-aware
    // — for `percent_of_spend` it returns a percent-of-tierSpend number,
    // for `fixed_rebate` it returns the flat dollar value, and for
    // unit-based tiers it short-circuits to 0 (those need
    // `computeRebateFromPrismaTerm` and unit counts). The old code
    // multiplied `bucket.spend * rebatePercent / 100` which (a) re-applied
    // the percent to the bucket instead of the tier-qualification spend,
    // and (b) zeroed out all non-percent rebate types because
    // `rebatePercent` is 0 for fixed/per-unit tiers.
    const facade = computeRebateFromPrismaTiers(tierSpend, tiers)
    const tierAchieved = facade.tierAchieved
    // Charles 2026-04-25 (drift fix): the prior implementation read
    // `Number(applicableTier.rebateValue)` raw and multiplied by
    // `bucket.spend`, which only worked because rebateValue is stored
    // as a fraction. Any future change to that storage convention
    // (or the addition of a non-fraction rebateType to the same
    // branch) would silently break this path. Use the facade's
    // canonical effective rate (`facade.rebateEarned / tierSpend`)
    // and re-apply to the month's own spend, so the unit convention
    // is owned exclusively by `computeRebateFromPrismaTiers`.
    const applicableTier = [...tiers]
      .sort((a, b) => Number(a.spendMin) - Number(b.spendMin))
      .reduce<(typeof tiers)[number] | null>(
        (best, t) => (tierSpend >= Number(t.spendMin) ? t : best),
        null,
      )
    let rebateEarned = 0
    if (applicableTier?.rebateType === "percent_of_spend") {
      const effectiveRate =
        tierSpend > 0 ? facade.rebateEarned / tierSpend : 0
      rebateEarned = bucket.spend * effectiveRate
    } else {
      // Fixed / per-unit / per-procedure — trust the facade (which
      // short-circuits unit-based types to 0 since we don't have unit
      // counts here). Fixed-rebate yields the flat tier value per period.
      rebateEarned = facade.rebateEarned
    }
    const rebateCollected = rebateEarned * DEFAULT_COLLECTION_RATE

    return {
      id: `synthetic-${contract.id}-${key}`,
      contractId: contract.id,
      facilityId: contract.facilityId ?? facilityId,
      periodStart: bucket.start,
      periodEnd: bucket.end,
      totalSpend: bucket.spend,
      totalVolume: 0,
      rebateEarned,
      rebateCollected,
      paymentExpected: 0,
      paymentActual: 0,
      balanceExpected: 0,
      balanceActual: 0,
      tierAchieved,
      createdAt: new Date(),
      updatedAt: new Date(),
      _synthetic: true as const,
      _periodIndex: idx,
    }
  })

  // UI expects desc order (latest first) — same as the persisted branch.
  return synthetic.reverse()
}
