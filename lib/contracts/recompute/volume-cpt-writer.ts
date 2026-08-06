// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract.

/**
 * Volume rebate accrual writer (Charles 2026-04-25).
 *
 * The peer of `recomputeAccrualForContract` for terms whose
 * `termType === "volume_rebate"`. Volume rebates count CPT-coded
 * procedure occurrences (deduped by case+CPT) within the term's
 * evaluation period and apply the resulting count to the term's tier
 * ladder.
 *
 * Why a separate writer:
 *   - The spend-rebate writer aggregates COG dollars; the volume-
 *     rebate writer aggregates Case procedures. Different data source,
 *     different reducer.
 *   - The volume engine already exists at
 *     `lib/rebates/engine/volume-rebate.ts` — this file is the
 *     Prisma → engine bridge that audit doc 2026-04-19 said was
 *     missing. See `docs/architecture/rebate-engine-map.md`.
 *
 * v1 scope (intentionally narrow — vendor-filter is a v2):
 *   - The term's `cptCodes` define what counts toward the rebate.
 *   - Cases are filtered by facility + dateOfSurgery within the term's
 *     [effectiveStart, effectiveEnd] window. No vendor filter — the
 *     CPT codes themselves provide the procedure scope.
 *   - One Rebate row per evaluation period (annual / quarterly /
 *     semi_annual / monthly), same cadence pattern as the spend writer.
 *   - Idempotent: deletes prior `[auto-volume-accrual]`-prefixed rows
 *     before inserting fresh ones (mirrors the AUTO_ACCRUAL_PREFIX
 *     pattern in recompute-accrual.ts), preserves any rows the user
 *     has manually collected (collectionDate set).
 *
 * Future v2 work captured in `rebate-engine-map.md`:
 *   - Vendor filter: only count Cases whose supplies include
 *     contract.vendorId items.
 *   - Per-occurrence fixed-rebate path (engine supports it via
 *     `fixedRebatePerOccurrence`; not yet exposed in the term schema).
 *   - Marginal/cumulative method honored from term.rebateMethod.
 *   - Baseline support (PRIOR_YEAR_ACTUAL on procedure counts).
 */
import { prisma } from "@/lib/db"
import { calculateRebate } from "@/lib/rebates/engine"
import { expandCategoriesToCogVariants } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import type {
  PeriodData,
  PurchaseRecord,
  RebateTier,
  VolumeRebateConfig,
} from "@/lib/rebates/engine/types"

// bugs.rtfd 2026-06-12 R1: prefix now lives in the shared family
// module so recomputeAccrualForContract's upfront wipe can cover
// every writer's rows (term-type edits left the prior writer's
// rows immortal — volume math 38,775 + stale 26,751 = 65,526).
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
import { recomputeVolumeFromCogRecords } from "@/lib/contracts/recompute/volume-cog-writer"
import { recomputeVolumeFromPurchaseOrders } from "@/lib/contracts/recompute/volume-po-writer"

/**
 * Persist Volume Rebate accrual rows for a single term. Returns the
 * number of rows inserted + summary totals.
 *
 * Caller is responsible for resolving the contract's facility scope
 * and supplying the term shape (load via Prisma with the fields
 * declared on `VolumeRebateTermLike`).
 */
export async function recomputeVolumeAccrualForTerm(input: {
  contractId: string
  facilityId: string
  contractEffectiveDate: Date
  contractExpirationDate: Date
  /**
   * Bug #16 (2026-05-24): when the parent contract is tie-in, every
   * auto-accrual row is system-stamped with collectionDate = periodEnd
   * (no user-collect workflow exists for tie-in). Set this true so the
   * delete filter wipes ALL auto-accrual rows for this term — not just
   * uncollected ones. Without this, Recompute is non-idempotent.
   */
  isTieIn?: boolean
  term: VolumeRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, facilityId, contractEffectiveDate, term, isTieIn } = input

  // Bug #17 (2026-05-08, Vick): two volume-rebate basis modes.
  // - When `term.cptCodes` is non-empty, qualification = CPT-coded
  //   procedure occurrences (existing behavior; no change below).
  // - When empty, qualification = line-item quantity summed across
  //   in-scope COG records (vendor + category filter). This branch
  //   delegates to `recomputeVolumeFromCogRecords` and returns early
  //   so we don't hit the CPT-only path.
  // Bug 2026-05-20 (Vick): purchase_order baseline path. Counts
  // distinct POs for the contract's vendor in the window and feeds
  // the count through the same tier ladder.
  if (term.volumeType === "purchase_order") {
    return recomputeVolumeFromPurchaseOrders(input)
  }
  const isCptMode = term.cptCodes && term.cptCodes.length > 0
  if (!isCptMode) {
    return recomputeVolumeFromCogRecords(input)
  }

  // Window: bound by contract effective range AND term effective range
  // AND today (no future buckets, same rule as spend writer).
  // Push date-only bounds to end-of-day so a period whose periodEnd
  // is the same calendar day as the contract/term expiration still
  // counts as in-window (Charles 2026-04-25 — same fix as the
  // threshold writer).
  const today = new Date()
  const startCandidates = [
    contractEffectiveDate.getTime(),
    term.effectiveStart?.getTime() ?? -Infinity,
  ]
  const start = new Date(Math.max(...startCandidates))
  const endCandidates = [
    today.getTime(),
    endOfDay(input.contractExpirationDate).getTime(),
    term.effectiveEnd ? endOfDay(term.effectiveEnd).getTime() : Infinity,
  ]
  const end = new Date(Math.min(...endCandidates))
  if (end.getTime() <= start.getTime()) {
    return { inserted: 0, sumEarned: 0 }
  }

  // Load every Case + procedure at the facility within the window.
  // Filter by procedure CPT in-memory — the term's cptCodes list is
  // typically small (single digits) and the index on Case is
  // facility+date, so loading all cases in window then filtering is
  // cheaper than a per-CPT subquery.
  const cases = await prisma.case.findMany({
    where: {
      facilityId,
      dateOfSurgery: { gte: start, lte: end },
    },
    select: {
      id: true,
      dateOfSurgery: true,
      procedures: { select: { cptCode: true } },
    },
  })
  const allowed = new Set(term.cptCodes)
  // Build a flat list of "purchase records" the engine can consume.
  // Each occurrence (case+CPT) becomes one PurchaseRecord with
  // quantity=1 and unitPrice=0; the engine only counts CPT
  // occurrences (deduped by caseId+cptCode) so the dollar fields
  // are unused for volume rebate.
  const purchases: PurchaseRecord[] = []
  for (const c of cases) {
    for (const p of c.procedures) {
      if (!allowed.has(p.cptCode)) continue
      purchases.push({
        referenceNumber: `case:${c.id}|cpt:${p.cptCode}`,
        quantity: 1,
        unitPrice: 0,
        extendedPrice: 0,
        purchaseDate: c.dateOfSurgery,
        cptCode: p.cptCode,
        caseId: c.id,
      })
    }
  }

  // Build the canonical-engine VOLUME_REBATE config from the term's
  // tier ladder.
  //
  // Charles canonical-engine wiring 2026-05-05: this writer used to
  // hand-roll cumulative + marginal math (raw `count × rebateValue`)
  // because the engine's shared cumulative/marginal helpers always
  // divide by 100 (inherited percent semantics). We now wire through
  // `calculateRebate(VOLUME_REBATE)`. Math equivalence is preserved by
  // the bridge boundary: `mapTier` in `lib/rebates/prisma-engine-bridge.ts`
  // multiplies unit-based dollar values (`fixed_rebate_per_unit`,
  // `per_procedure_rebate`) by 100, so the engine's /100 yields the
  // original `count × tier.rebateValue` formula. See the rules table
  // at the top of the bridge for the full conversion contract.
  //
  // Replicates the bridge's `mapTier` logic inline (without invoking
  // the bridge directly) because the writer's `term.tiers` shape is a
  // narrow subset of `PrismaContractTier`. The conversion is
  // intentionally kept identical to the bridge so future audits land
  // in one obvious place.
  const tiers: RebateTier[] = term.tiers
    .map((t) => {
      const rebateValueRaw = Number(t.rebateValue ?? 0)
      const isUnitBased =
        t.rebateType === "fixed_rebate_per_unit" ||
        t.rebateType === "per_procedure_rebate"
      const isFixedRebate = t.rebateType === "fixed_rebate"
      // For unit-based: ×100 to undo engine's internal /100.
      // For fixed-rebate (period flat): force rebateValue=0 and
      // surface the dollars via fixedRebateAmount so the engine
      // short-circuits to the flat amount on tier qualification.
      // For unknown/null/legacy `rebateType`: fall back to the
      // pre-wiring behavior (treat as raw dollars-per-occurrence,
      // ×100 so engine math yields the same number). This keeps
      // older seed contracts (which omit rebateType on volume tiers)
      // numerically identical to the prior writer.
      const rebateValueForEngine = isFixedRebate
        ? 0
        : isUnitBased
          ? rebateValueRaw * 100
          : rebateValueRaw * 100
      // Bug #13: volume tiers express their threshold in the
      // `volumeMin/volumeMax` columns (occurrence count, Int). The
      // bridge previously read `spendMin/spendMax` (dollar Decimal,
      // default 0), so EVERY volume tier had thresholdMin=0 and the
      // cumulative engine silently always picked the top tier — that's
      // why "Volume rebates calculate incorrect" recurred even after
      // the form-side fixes. Prefer volumeMin when set; fall back to
      // spendMin only for legacy rows that wrote the threshold to the
      // wrong column.
      const tVolMin =
        (t as unknown as { volumeMin?: number | null }).volumeMin
      const tVolMax =
        (t as unknown as { volumeMax?: number | null }).volumeMax
      const thresholdMin =
        tVolMin != null && Number.isFinite(Number(tVolMin))
          ? Number(tVolMin)
          : Number(t.spendMin ?? 0)
      const thresholdMax =
        tVolMax != null && Number.isFinite(Number(tVolMax))
          ? Number(tVolMax)
          : t.spendMax === null || t.spendMax === undefined
            ? null
            : Number(t.spendMax)
      return {
        tierNumber: t.tierNumber,
        tierName: t.tierName,
        thresholdMin,
        thresholdMax,
        rebateValue: rebateValueForEngine,
        fixedRebateAmount: isFixedRebate ? rebateValueRaw : null,
      }
    })
    .sort((a, b) => a.thresholdMin - b.thresholdMin)

  // Spec 2026-05-17: when ANY tier on the term uses `percent_of_spend`,
  // the dollar number depends on in-scope COG spend per bucket, not on
  // occurrence count × rate. Tier selection still uses occurrences;
  // only the dollar replacement comes from COG spend. Fetch once
  // upfront and sum per bucket in-memory.
  const hasPercentOfSpendTier = term.tiers.some(
    (t) => t.rebateType === "percent_of_spend",
  )
  const spendByDate: Array<{ transactionDate: Date; extendedPrice: number }> =
    []
  // bugs.rtfd 2026-06-11 A5: gate on the EFFECTIVE vendor set, not the
  // bare primary vendorId — a term whose vendor scope comes only from
  // the group set (`vendorIds`) must still fetch its COG spend basis.
  if (hasPercentOfSpendTier && termVendorIds(term).length > 0) {
    const isSpecificCategory =
      term.appliesTo === "specific_category" &&
      Array.isArray(term.categories) &&
      (term.categories?.length ?? 0) > 0
    // 2026-06-08: expand to drifted COG category variants (canonical match)
    // so percent-of-spend volume terms don't drop case/word-order-different
    // rows (Charles "category check is off").
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
    const cogForSpend = await prisma.cOGRecord.findMany({
      where: {
        facilityId,
        vendorId: { in: termVendorIds(term) },
        transactionDate: { gte: start, lte: end },
        ...categoryFilter,
      },
      select: { transactionDate: true, extendedPrice: true },
    })
    for (const r of cogForSpend) {
      spendByDate.push({
        transactionDate: r.transactionDate,
        extendedPrice: r.extendedPrice == null ? 0 : Number(r.extendedPrice),
      })
    }
  }

  // Bucket purchases by evaluation period. Iterate from start through
  // end in evaluation-period steps, computing rebate per bucket.
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  // bugs.rtfd 2026-06-14 ("it should take the volume on all product use and
  // give $15 per unit"): a `lifetime` volume term qualifies on CUMULATIVE
  // units over the whole contract, not per-year. One window spanning
  // firstWindowStart → end (end is already min(today, contract/term end)),
  // so 26,568 cumulative units clear the 21,000 tier-2 threshold instead of
  // each year (≤11,304) sitting in tier 1. Mirrors the spend writer's
  // lifetime mode in buildEvaluationPeriodAccruals.
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
    purchases: PurchaseRecord[]
  }
  const buckets: Bucket[] = []
  const isLifetime = term.evaluationPeriod === "lifetime"
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    // bugs.rtfd 2026-06-14: lifetime = one window clamped to `end` (see the
    // COG-fallback writer for the rationale).
    const periodEnd = isLifetime ? end : new Date(next.getTime() - 1)
    if (!isLifetime && periodEnd.getTime() > end.getTime()) break
    const bucketPurchases = purchases.filter((p) => {
      const t = p.purchaseDate.getTime()
      return t >= cursor.getTime() && t <= periodEnd.getTime()
    })
    buckets.push({
      periodStart: cursor,
      periodEnd,
      purchases: bucketPurchases,
    })
    if (isLifetime) break
    cursor = next
  }

  // Compute rebate per bucket via the canonical engine. The engine
  // performs its own [A5] dedup (caseId+cptCode → date+cptCode fallback)
  // and handles cumulative vs marginal — we hand it the per-bucket
  // PurchaseRecord slice and let it produce the dollar number.
  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    occurrences: number
    rebateEarned: number
    bucketSpend: number
    percentOfSpendApplied: boolean
  }
  const volumeConfig: VolumeRebateConfig = {
    type: "VOLUME_REBATE",
    method: term.rebateMethod === "marginal" ? "MARGINAL" : "CUMULATIVE",
    boundaryRule: "EXCLUSIVE",
    tiers,
    cptCodes: term.cptCodes,
    baselineType: "NONE",
    negotiatedBaseline: null,
    growthOnly: false,
    fixedRebatePerOccurrence: null,
  }
  const results: BucketResult[] = buckets.map((b) => {
    // Reproduce the [A5] dedup so the diagnostic notes string can
    // continue to display the occurrence count alongside the engine's
    // dollar number.
    const seen = new Set<string>()
    for (const p of b.purchases) {
      if (p.cptCode == null) continue
      if (!new Set(term.cptCodes).has(p.cptCode)) continue
      const key = p.caseId
        ? `case:${p.caseId}|cpt:${p.cptCode ?? ""}`
        : `date:${p.purchaseDate.toISOString().slice(0, 10)}|cpt:${p.cptCode ?? ""}`
      seen.add(key)
    }
    const occurrences = seen.size
    const periodData: PeriodData = {
      purchases: b.purchases,
      totalSpend: 0,
    }
    const result = calculateRebate(volumeConfig, periodData)
    let rebateEarned = result.rebateEarned
    let bucketSpend = 0
    let percentOfSpendApplied = false
    // Spec 2026-05-17: replace engine dollars for percent_of_spend tiers.
    // The engine has no percent_of_spend branch, so it would pay
    // `occurrences × fraction × 100` (totally wrong). Tier selection still
    // comes from the engine (which gates on occurrence count); we only
    // swap the dollar number when the achieved tier is percent_of_spend.
    //
    // Method semantics:
    //  - cumulative: top achieved tier's rate × whole bucket spend.
    //  - marginal:   sum over EVERY tier the occurrence count crossed
    //    of `(slice_occurrences / total_occurrences × bucketSpend) × tierRate`.
    //    Prorates bucket spend by per-tier occurrence share — same shape
    //    as `calculateMarginalRebate` but in $-space.
    if (hasPercentOfSpendTier && result.tierResult?.tier) {
      const achievedTierNumber = result.tierResult.tier.tierNumber
      const achievedTermTier = term.tiers.find(
        (t) => t.tierNumber === achievedTierNumber,
      )
      const isMarginal = term.rebateMethod === "marginal"
      const cumulativePercentTier =
        !isMarginal && achievedTermTier?.rebateType === "percent_of_spend"
      const anyPercentTierInLadder = term.tiers.some(
        (t) => t.rebateType === "percent_of_spend",
      )
      const shouldReplace =
        cumulativePercentTier || (isMarginal && anyPercentTierInLadder)
      if (shouldReplace) {
        for (const r of spendByDate) {
          const t = r.transactionDate.getTime()
          if (t >= b.periodStart.getTime() && t <= b.periodEnd.getTime()) {
            bucketSpend += r.extendedPrice
          }
        }
        if (isMarginal) {
          // Marginal: prorate bucket spend by each tier's occurrence
          // slice and sum. Per-tier rate respects rebateType — only
          // `percent_of_spend` tiers earn against spend; flat /
          // per-unit tiers retain their existing engine contribution
          // and we leave the engine's $ for those slices alone by
          // computing the percent-share contribution as a *delta*
          // against the engine's cumulative-occurrences math.
          //
          // Implementation: walk the sorted-asc ladder, compute each
          // tier's [sliceMin, sliceMax) crossed by `occurrences`, then
          // for percent_of_spend tiers add `(slice/total) × bucketSpend
          // × fraction` to rebateEarned; engine already paid the
          // non-percent slices via its marginal helper.
          const sortedTermTiers = [...term.tiers]
            .map((t) => ({
              tierNumber: t.tierNumber,
              rebateType: t.rebateType ?? null,
              rebateValue: Number(t.rebateValue ?? 0),
              volumeMin:
                (t as unknown as { volumeMin?: number | null }).volumeMin ??
                Number(t.spendMin ?? 0),
              volumeMax: (() => {
                const v = (t as unknown as { volumeMax?: number | null })
                  .volumeMax
                if (v != null && Number.isFinite(Number(v))) return Number(v)
                if (t.spendMax === null || t.spendMax === undefined) return null
                return Number(t.spendMax)
              })(),
            }))
            .sort((a, b) => a.volumeMin - b.volumeMin)
          let percentContribution = 0
          let engineDoubleCount = 0
          for (const t of sortedTermTiers) {
            if (occurrences <= t.volumeMin) continue
            const sliceTop =
              t.volumeMax == null ? occurrences : Math.min(occurrences, t.volumeMax)
            const slice = Math.max(0, sliceTop - t.volumeMin)
            if (slice <= 0) continue
            if (t.rebateType === "percent_of_spend") {
              const prorated = occurrences > 0 ? (slice / occurrences) * bucketSpend : 0
              percentContribution += prorated * t.rebateValue
              // Engine paid `slice × rebateValueForEngine / 100` for
              // this slice. rebateValueForEngine = rebateValue × 100
              // (the percent_of_spend boundary scaling), so the net
              // engine $ per slice = slice × rebateValue. Subtract
              // that out so we don't double-count.
              engineDoubleCount += slice * t.rebateValue
            }
          }
          rebateEarned = result.rebateEarned - engineDoubleCount + percentContribution
        } else {
          // Cumulative: top tier's rate × whole bucket spend.
          const fraction = Number(achievedTermTier?.rebateValue ?? 0)
          rebateEarned = bucketSpend * fraction
        }
        percentOfSpendApplied = true
      }
    }
    return {
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      occurrences,
      rebateEarned,
      bucketSpend,
      percentOfSpendApplied,
    }
  })

  // Idempotent persist: delete prior auto-volume rows for THIS term
  // (uncollected only — preserve user-collected rows). The notes
  // prefix carries the term id so multi-term contracts don't clobber
  // each other.
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
    if (r.rebateEarned <= 0 && r.occurrences <= 0) continue
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
      notes: r.percentOfSpendApplied
        ? `${termPrefix} · ${r.occurrences} occurrences · spend=$${r.bucketSpend.toFixed(2)} · $${r.rebateEarned.toFixed(2)}`
        : `${termPrefix} · ${r.occurrences} occurrences · $${r.rebateEarned.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return { inserted: toInsert.length, sumEarned }
}
