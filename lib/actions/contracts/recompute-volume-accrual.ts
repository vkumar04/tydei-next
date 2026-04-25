"use server"

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
import type { PurchaseRecord, RebateTier } from "@/lib/rebates/engine/types"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"

const AUTO_VOLUME_PREFIX = "[auto-volume-accrual]"

interface VolumeRebateTermLike {
  id: string
  cptCodes: string[]
  rebateMethod: string | null
  evaluationPeriod: string | null
  effectiveStart: Date | null
  effectiveEnd: Date | null
  tiers: Array<{
    tierNumber: number
    tierName: string | null
    spendMin: unknown
    spendMax: unknown
    rebateValue: unknown
  }>
}

/**
 * Width in months of an evaluation period. Mirrors
 * `lib/contracts/accrual.ts monthsInEvaluationPeriod` so volume
 * rebates bucket the same way spend rebates do.
 */
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
  term: VolumeRebateTermLike
}): Promise<{ inserted: number; sumEarned: number }> {
  const { contractId, facilityId, contractEffectiveDate, term } = input

  // Defensive: a volume rebate without CPT codes can't compute
  // anything meaningful. Skip silently — UI surfaces a "no CPT codes
  // configured" hint when present.
  if (!term.cptCodes || term.cptCodes.length === 0) {
    return { inserted: 0, sumEarned: 0 }
  }

  // Window: bound by contract effective range AND term effective range
  // AND today (no future buckets, same rule as spend writer).
  // Push date-only bounds to end-of-day so a period whose periodEnd
  // is the same calendar day as the contract/term expiration still
  // counts as in-window (Charles 2026-04-25 — same fix as the
  // threshold writer).
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

  // Build the engine config from the term's tier ladder. Volume
  // tier thresholds are in OCCURRENCES (not dollars) — `spendMin` /
  // `spendMax` columns are reused but interpreted as counts.
  // `rebateValue` is dollars-per-occurrence at this tier.
  const tiers: RebateTier[] = term.tiers
    .map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName,
      thresholdMin: Number(t.spendMin ?? 0),
      thresholdMax:
        t.spendMax === null || t.spendMax === undefined
          ? null
          : Number(t.spendMax),
      rebateValue: Number(t.rebateValue ?? 0),
    }))
    .sort((a, b) => a.thresholdMin - b.thresholdMin)

  /**
   * Volume rebate calculator. We DON'T delegate to
   * `calculateVolumeRebate` here because its tier path uses the
   * shared cumulative helper which divides by 100 (percent
   * semantics inherited from spend rebate). Volume tiers store
   * `rebateValue` as DOLLARS per occurrence at the achieved tier,
   * not a percent — so rebate = occurrences × tier.rebateValue.
   *
   * Marginal volume splits across tier brackets at each tier's
   * own per-occurrence rate.
   */
  function computeVolumeRebate(
    occurrences: number,
    tierLadder: RebateTier[],
    method: "cumulative" | "marginal",
  ): number {
    if (occurrences <= 0 || tierLadder.length === 0) return 0
    if (method === "marginal") {
      let total = 0
      for (let i = 0; i < tierLadder.length; i++) {
        const t = tierLadder[i]
        if (occurrences <= t.thresholdMin) break
        const next = tierLadder[i + 1]
        const upper = next ? next.thresholdMin : Infinity
        const inThisTier = Math.max(
          0,
          Math.min(occurrences, upper) - t.thresholdMin,
        )
        total += inThisTier * t.rebateValue
      }
      return total
    }
    // cumulative: achieved tier's $/occurrence × total occurrences.
    const achieved = determineTier(occurrences, tierLadder, "EXCLUSIVE")
    if (!achieved) return 0
    return occurrences * achieved.rebateValue
  }

  // Bucket purchases by evaluation period. Iterate from start through
  // end in evaluation-period steps, computing rebate per bucket.
  const width = widthMonths(term.evaluationPeriod)
  const firstWindowStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  type Bucket = {
    periodStart: Date
    periodEnd: Date
    purchases: PurchaseRecord[]
  }
  const buckets: Bucket[] = []
  let cursor = firstWindowStart
  for (let iter = 0; iter < 200; iter++) {
    const next = addMonthsUTC(cursor, width)
    const periodEnd = new Date(next.getTime() - 1)
    if (periodEnd.getTime() > end.getTime()) break
    const bucketPurchases = purchases.filter((p) => {
      const t = p.purchaseDate.getTime()
      return t >= cursor.getTime() && t <= periodEnd.getTime()
    })
    buckets.push({
      periodStart: cursor,
      periodEnd,
      purchases: bucketPurchases,
    })
    cursor = next
  }

  // Compute rebate per bucket — volume engine semantics are
  // "$X per occurrence at the achieved tier" (cumulative) or
  // "$X per occurrence per bracket" (marginal).
  type BucketResult = {
    periodStart: Date
    periodEnd: Date
    occurrences: number
    rebateEarned: number
  }
  const method: "cumulative" | "marginal" =
    term.rebateMethod === "marginal" ? "marginal" : "cumulative"
  const results: BucketResult[] = buckets.map((b) => {
    // Dedup occurrences by caseId+cptCode (the engine docs' [A5] rule).
    const seen = new Set<string>()
    for (const p of b.purchases) {
      const key = p.caseId
        ? `case:${p.caseId}|cpt:${p.cptCode ?? ""}`
        : `date:${p.purchaseDate.toISOString().slice(0, 10)}|cpt:${p.cptCode ?? ""}`
      seen.add(key)
    }
    const occurrences = seen.size
    return {
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      occurrences,
      rebateEarned: computeVolumeRebate(occurrences, tiers, method),
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
      collectionDate: null,
      notes: { startsWith: termPrefix },
    },
  })

  let sumEarned = 0
  const toInsert: Array<{
    contractId: string
    facilityId: string
    rebateEarned: number
    rebateCollected: number
    payPeriodStart: Date
    payPeriodEnd: Date
    collectionDate: null
    notes: string
  }> = []
  for (const r of results) {
    if (r.rebateEarned <= 0 && r.occurrences <= 0) continue
    sumEarned += r.rebateEarned
    toInsert.push({
      contractId,
      facilityId,
      rebateEarned: r.rebateEarned,
      rebateCollected: 0,
      payPeriodStart: r.periodStart,
      payPeriodEnd: r.periodEnd,
      collectionDate: null,
      notes: `${termPrefix} · ${r.occurrences} occurrences · $${r.rebateEarned.toFixed(2)}`,
    })
  }
  if (toInsert.length > 0) {
    await prisma.rebate.createMany({ data: toInsert, skipDuplicates: true })
  }

  return { inserted: toInsert.length, sumEarned }
}
