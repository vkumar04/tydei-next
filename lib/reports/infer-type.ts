/**
 * Reports hub — rebate "by type" attribution helpers (pure).
 *
 * Shared by the facility action `getRebateBreakdownByType`
 * (`lib/actions/reports/by-rebate-type.ts`) and its vendor mirror
 * `getVendorRebateBreakdownByType`
 * (`lib/actions/vendor-reports/by-rebate-type.ts`). The two actions are
 * byte-identical except for the auth gate + scope helper; this module is
 * the one place the auto-accrual notes-prefix → termType attribution
 * logic lives so the two surfaces can never drift.
 *
 * Maps an auto-accrual notes prefix to a fallback termType label, used
 * only when the row's `term:<id>` cannot be resolved (term was deleted,
 * notes truncated, etc.). Threshold rows fall back to `compliance_rebate`
 * rather than the synthetic "compliance_or_market_share" literal — the
 * bucket is still imprecise but it's at least a real enum value the UI
 * knows how to label. Charles 2026-04-25 audit facility C2.
 */
export const PREFIX_TO_INFERRED_TYPE: Record<string, string> = {
  "[auto-accrual]": "spend_rebate",
  "[auto-volume-accrual]": "volume_rebate",
  "[auto-po-accrual]": "po_rebate",
  "[auto-threshold-accrual]": "compliance_rebate",
  "[auto-invoice-accrual]": "payment_rebate",
}

export function inferTypeFromNotes(notes: string | null): {
  termId: string | null
  fallbackType: string
} {
  if (!notes) return { termId: null, fallbackType: "manual" }
  // Try each prefix.
  for (const [prefix, type] of Object.entries(PREFIX_TO_INFERRED_TYPE)) {
    if (notes.startsWith(prefix)) {
      // Notes shape: "[auto-X-accrual] term:<id> · …"
      const match = notes.match(/term:([a-z0-9]+)/i)
      return {
        termId: match?.[1] ?? null,
        fallbackType: type,
      }
    }
  }
  return { termId: null, fallbackType: "manual" }
}

export interface RebateTypeBucket {
  termType: string
  earned: number
  collected: number
  rowCount: number
  contractCount: number
  /**
   * True when ANY row in this bucket was attributed via the auto-*
   * notes-prefix fallback (term lookup missed) rather than a clean
   * term:<id> resolution. Surfaces in the UI as an "inferred from
   * notes prefix" badge so the reviewer knows the bucket is best-
   * effort. Charles 2026-04-25 audit re-pass F1.
   */
  inferred: boolean
}

/**
 * Anything with a numeric `toString()` — covers JS `number`, `string`, and
 * Prisma's `Decimal` without pulling `@prisma/client/runtime` into a
 * framework-free module. Mirrors `CollectedRebateLike` in
 * `lib/contracts/rebate-collected-filter.ts` so `sumCollectedRebates` can
 * be passed straight in as the `sumCollected` argument.
 */
interface DecimalLike {
  toString(): string
}

/** Minimal Rebate-row shape the bucketer reads. */
export interface RebateRowForBucket {
  contractId: string
  rebateEarned: DecimalLike | number | string | null | undefined
  rebateCollected: DecimalLike | number | string | null | undefined
  collectionDate: Date | string | null | undefined
  notes: string | null
}

/**
 * Pure core for the "rebates by type" breakdown. Given the already-loaded
 * (and explicitly tenant-scoped — facility OR vendor) Rebate rows plus the
 * term.id → termType map for the same scope, bucket each row by termType
 * and aggregate earned / collected / counts.
 *
 * `sumCollected` is injected so the caller routes the collected aggregate
 * through the canonical `sumCollectedRebates` helper (the "Collected"
 * filter, `collectionDate != null`, is owned by exactly one place — see
 * CLAUDE.md canonical-reducers invariants table). Keeping it as a
 * parameter avoids importing the action-layer reducer into a pure module
 * while preserving byte-identical output.
 */
export function bucketRebatesByType(
  rebates: RebateRowForBucket[],
  termTypeById: Map<string, string>,
  sumCollected: (rows: RebateRowForBucket[]) => number,
): RebateTypeBucket[] {
  const buckets = new Map<
    string,
    {
      earned: number
      collected: number
      rowCount: number
      contracts: Set<string>
      // True when at least one row landed in this bucket via the prefix
      // fallback (manual rows or rows whose term:<id> didn't resolve).
      // Drives the UI's "inferred from notes prefix" badge so the
      // reviewer knows the attribution is best-effort.
      inferred: boolean
    }
  >()
  for (const r of rebates) {
    const inferred = inferTypeFromNotes(r.notes)
    let termType: string
    let isInferred: boolean
    if (inferred.termId && termTypeById.has(inferred.termId)) {
      termType = termTypeById.get(inferred.termId)!
      isInferred = false
    } else {
      termType = inferred.fallbackType
      isInferred = true
    }
    const bucket = buckets.get(termType) ?? {
      earned: 0,
      collected: 0,
      rowCount: 0,
      contracts: new Set<string>(),
      inferred: false,
    }
    bucket.earned += Number(r.rebateEarned ?? 0)
    bucket.collected += sumCollected([r])
    bucket.rowCount += 1
    bucket.contracts.add(r.contractId)
    if (isInferred) bucket.inferred = true
    buckets.set(termType, bucket)
  }

  const result: RebateTypeBucket[] = []
  for (const [termType, b] of buckets.entries()) {
    result.push({
      termType,
      earned: b.earned,
      collected: b.collected,
      rowCount: b.rowCount,
      contractCount: b.contracts.size,
      inferred: b.inferred,
    })
  }
  // Sort biggest earned first — most material first.
  result.sort((a, b) => b.earned - a.earned)
  return result
}
