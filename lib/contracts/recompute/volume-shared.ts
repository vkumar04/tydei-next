// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract. Do NOT add the
// directive to this module: its exports are sync helpers and would be
// flagged by use-server-async-export-scanner.test.ts (and worse,
// registered as server actions).

/**
 * Shared term shape + window helpers for the volume-rebate writer
 * family (decomposition 2026-08-05). The public import surface stays
 * `@/lib/contracts/recompute/volume` — import from there, not here,
 * unless you are one of the volume-* sibling modules.
 */

export interface VolumeRebateTermLike {
  id: string
  cptCodes: string[]
  /**
   * Bug #17: when cptCodes is empty, the writer falls back to
   * summing line-item quantity from COG records — those need to be
   * filtered by the contract's vendor and the term's category scope.
   * Optional + nullable to keep the type tolerant of legacy callers
   * that haven't been upgraded. bugs.rtfd 2026-06-11 A5: the fallback
   * writers gate on the EFFECTIVE vendor set (`termVendorIds` —
   * `vendorIds ?? [vendorId]`), so a missing primary vendorId only
   * means "no in-scope spend" when `vendorIds` is also empty.
   */
  vendorId?: string | null
  /**
   * #2 (Vick 2026-05-31): full participating vendor set for grouped
   * contracts. The COG/PO basis spans all of them; the writer falls back
   * to [vendorId] when absent, so legacy callers are unchanged.
   */
  vendorIds?: string[] | null
  categories?: string[]
  appliesTo?: string | null
  /**
   * Bug 2026-05-20 (Vick): adds the `purchase_order` basis mode. When
   * set the writer counts distinct PurchaseOrders for the contract's
   * vendor instead of CPT procedures or COG units.
   */
  volumeType?: string | null
  rebateMethod: string | null
  evaluationPeriod: string | null
  effectiveStart: Date | null
  effectiveEnd: Date | null
  tiers: Array<{
    tierNumber: number
    tierName: string | null
    spendMin: unknown
    spendMax: unknown
    /**
     * Bug #13: volume tiers store their threshold in volumeMin/volumeMax
     * (Int columns), not spendMin/spendMax (dollar Decimal). Pass these
     * through so the bridge can translate the right column into the
     * engine's thresholdMin/thresholdMax. Optional for legacy callers
     * that haven't been updated.
     */
    volumeMin?: number | null
    volumeMax?: number | null
    rebateValue: unknown
    /**
     * Charles canonical-engine wiring 2026-05-05: required so the
     * VOLUME_REBATE engine path can scale unit-based dollar values
     * (`fixed_rebate_per_unit`, `per_procedure_rebate`) by ×100 to
     * undo the engine's internal /100 — see the rules table in
     * `lib/rebates/prisma-engine-bridge.ts`. Optional/unknown is
     * tolerated for legacy callers; we default to treating the value
     * as raw dollars-per-unit (the prior writer behavior).
     */
    rebateType?: string | null
  }>
}

/**
 * Width in months of an evaluation period. Mirrors
 * `lib/contracts/accrual.ts monthsInEvaluationPeriod` so volume
 * rebates bucket the same way spend rebates do.
 */
export function widthMonths(eval_: string | null): number {
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

export function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}

/**
 * Push a date-only bound to end-of-day (UTC) so a period whose
 * periodEnd is the same calendar day as the contract/term expiration
 * still counts as in-window (Charles 2026-04-25 — same fix as the
 * threshold writer). Decomposition 2026-08-05: hoisted verbatim from
 * the four identical inline copies in the volume writer family.
 */
export function endOfDay(d: Date): Date {
  return new Date(
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
}

/** #2: effective vendor set for a term — group set when present, else [vendorId]. */
export function termVendorIds(t: VolumeRebateTermLike): string[] {
  return t.vendorIds ?? (t.vendorId ? [t.vendorId] : [])
}
