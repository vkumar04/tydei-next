// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract. Do NOT add the
// directive to this module.

import { prisma } from "@/lib/db"
import { expandCategoriesToCogVariants } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { AUTO_VOLUME_PREFIX } from "@/lib/contracts/recompute/auto-accrual-prefixes"
import {
  loadPreservedCollectedPeriods,
  periodKey,
} from "@/lib/contracts/recompute/preserved-collected"
import type { VolumeRebateTermLike } from "@/lib/contracts/recompute/volume-shared"
import {
  addMonthsUTC,
  endOfDay,
  termVendorIds,
  widthMonths,
} from "@/lib/contracts/recompute/volume-shared"
import {
  computeVolumeTierRebate,
  normalizeVolumeTiers,
} from "@/lib/contracts/recompute/volume-tier-math"

/**
 * Bug #17 (2026-05-08, Vick): COG-records fallback for volume rebates
 * whose tier ladder gates on QTY of items used (no CPT codes set).
 *
 * Pipeline:
 *   1. Query COG records for the contract's vendor + the term's
 *      category scope, within the term's effective window.
 *   2. Bucket into evaluation-period windows (mirrors the CPT-path
 *      bucketing).
 *   3. Per bucket: sum `quantity` (the qualification metric) and
 *      `extendedPrice` (the dollar base for `% of Spend` tiers).
 *   4. Determine the achieved cumulative tier by quantitySum vs
 *      `volumeMin / volumeMax`. (Marginal not supported on this path
 *      yet — falls back to cumulative; opens a follow-up.)
 *   5. Compute the rebate $ per the achieved tier's `rebateType`:
 *        - `percent_of_spend` → bucketSpend × rebateValue (stored as
 *          fraction, 0.02 = 2%; no /100 needed)
 *        - `fixed_rebate`     → flat `rebateValue` dollars
 *        - `fixed_rebate_per_unit` / `per_procedure_rebate` / null →
 *          quantitySum × rebateValue (raw $/unit)
 *   6. Persist as `[auto-volume-accrual]` rows with the same
 *      term-prefix idempotency contract as the CPT path.
 *
 * No schema migration: `term.cptCodes.length === 0` is the implicit
 * mode flag. Future work (Bug #18) adds an explicit `volumeBasis`
 * picker on the form so the user doesn't have to leave cptCodes
 * blank to opt in.
 */
export async function recomputeVolumeFromCogRecords(input: {
  contractId: string
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  isTieIn?: boolean
  term: VolumeRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, facilityId, contractEffectiveDate, term, isTieIn } = input
  // bugs.rtfd 2026-06-11 A5: early-return only when the EFFECTIVE vendor
  // set is empty. The old `!term.vendorId` gate returned $0 for any term
  // whose vendor scope comes solely from the group set (`vendorIds`) —
  // the group-vendor drift class: scope via the contractVendorIds()-shaped
  // set, never the bare primary vendorId.
  const vendorIds = termVendorIds(term)
  if (vendorIds.length === 0) {
    return { inserted: 0, sumEarned: 0 }
  }

  const today = new Date()
  const start = new Date(
    Math.max(
      contractEffectiveDate.getTime(),
      term.effectiveStart?.getTime() ?? -Infinity,
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

  // Build the term's category scope. Mirrors `buildCategoryWhereClause`
  // semantics inline (the writer's term shape is narrower than the
  // helper's expected input).
  const isSpecificCategory =
    term.appliesTo === "specific_category" &&
    Array.isArray(term.categories) &&
    term.categories.length > 0
  const categoryFilter = isSpecificCategory
    ? {
        category: {
          in: expandCategoriesToCogVariants(
            Array.from(new Set(term.categories ?? [])),
            await facilityCogCategoryUniverse(facilityId),
          ),
        },
      }
    : {}

  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      vendorId: { in: vendorIds },
      transactionDate: { gte: start, lte: end },
      ...categoryFilter,
    },
    select: {
      transactionDate: true,
      quantity: true,
      extendedPrice: true,
    },
  })

  // Bucket by evaluation period.
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  // bugs.rtfd 2026-06-14: lifetime = ONE window over the whole contract so
  // cumulative all-product units qualify the tier (26,568 ≥ 21,000 → $15/unit)
  // instead of per-year buckets each in tier 1. `end` is already min(today,
  // contract/term end). Same handling as the CPT path in volume-cpt-writer.ts.
  const width =
    term.evaluationPeriod === "lifetime"
      ? Math.max(
          1,
          (end.getUTCFullYear() - firstWindowStart.getUTCFullYear()) * 12 +
            (end.getUTCMonth() - firstWindowStart.getUTCMonth()) +
            1,
        )
      : widthMonths(term.evaluationPeriod)
  type Bucket = {
    periodStart: Date
    periodEnd: Date
    quantitySum: number
    spendSum: number
  }
  const buckets: Bucket[] = []
  const isLifetime = term.evaluationPeriod === "lifetime"
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    // bugs.rtfd 2026-06-14: lifetime is ONE window [firstWindowStart, end].
    // `end` (= min(today, contract/term end)) is rarely on a month boundary,
    // so clamp periodEnd to `end` rather than the month-aligned overshoot that
    // would `break` the loop and drop the window entirely.
    const periodEnd = isLifetime ? end : new Date(next.getTime() - 1)
    if (!isLifetime && periodEnd.getTime() > end.getTime()) break
    let qSum = 0
    let spendSum = 0
    for (const r of cogRecords) {
      const t = r.transactionDate.getTime()
      if (t < cursor.getTime() || t > periodEnd.getTime()) continue
      qSum += r.quantity ?? 0
      spendSum += r.extendedPrice == null ? 0 : Number(r.extendedPrice)
    }
    buckets.push({
      periodStart: cursor,
      periodEnd,
      quantitySum: qSum,
      spendSum,
    })
    if (isLifetime) break
    cursor = next
  }

  // F2 (2026-06-11): tier normalization + cumulative pick + reward math
  // moved to the exported pure helpers (volume-tier-math.ts) so the accrual
  // timeline's in-progress display calls the SAME functions —
  // writer-consistent by construction, zero behavior change here.
  const sortedTiers = normalizeVolumeTiers(term.tiers)

  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    quantity: number
    rebateEarned: number
  }
  const results: BucketResult[] = buckets.map((b) => {
    const { rebateEarned } = computeVolumeTierRebate(
      sortedTiers,
      b.quantitySum,
      b.spendSum,
    )
    return {
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      quantity: b.quantitySum,
      rebateEarned,
    }
  })

  const termPrefix = `${AUTO_VOLUME_PREFIX} term:${term.id}`
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

  // Windows already covered by a COLLECTED row. Those rows survive the delete
  // above (it spares collectionDate != null), so re-inserting their window
  // duplicates them permanently — 2026-07-29 math audit.
  const preservedCollected = await loadPreservedCollectedPeriods(
    contractId,
    termPrefix,
    isTieIn,
  )

  let sumEarned = 0
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
  for (const r of results) {
    if (r.rebateEarned <= 0 && r.quantity <= 0) continue
    // Skip a window a COLLECTED row already covers — see the load above.
    if (preservedCollected.has(periodKey(r.periodStart, r.periodEnd))) continue
    sumEarned += r.rebateEarned
    toInsert.push({
      contractId,
      facilityId,
      rebateEarned: r.rebateEarned,
      // See carve-out.ts:248 — tie-in auto-stamps collectionDate at
      // accrual so the rebate flows into "applied to capital".
      rebateCollected: isTieIn ? r.rebateEarned : 0,
      payPeriodStart: r.periodStart,
      payPeriodEnd: r.periodEnd,
      collectionDate: isTieIn ? r.periodEnd : null,
      notes: `${termPrefix} · ${r.quantity} units · $${r.rebateEarned.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return { inserted: toInsert.length, sumEarned }
}
