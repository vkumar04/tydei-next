/**
 * Canonical display labels for `ContractTerm.rebateMethod`.
 *
 * The Prisma enum values (`cumulative`, `marginal`) are opaque
 * technical names. "Cumulative" reads like tier-slicing to procurement
 * users, but the engine's `cumulative` is actually retroactive (whole
 * spend × top-tier rate). The other direction is equally confusing.
 *
 * Historically the UI labeled them inconsistently:
 *   - contract-terms-entry:     "Dollar 1 (Cumulative)" / "Growth (Marginal)"
 *   - contract-terms-display:   "Dollar 1 (Cumulative)" / "Growth (Marginal)"
 *   - contract-accrual-timeline: "Cumulative" / "Marginal (bracket)"
 *   - renewal-brief:            raw "cumulative" / "marginal"
 *
 * All of these should go through the same helper so users see one
 * consistent vocabulary. Canonical form lands on the more descriptive
 * rebate-terminology: "Retroactive" and "Tiered", with parentheticals
 * that preserve the technical names for power users.
 */
export type RebateMethodName = "cumulative" | "marginal"

export function formatRebateMethodLabel(
  method: RebateMethodName | string | null | undefined,
  opts: { short?: boolean } = {},
): string {
  const m = (method ?? "cumulative") as RebateMethodName
  if (opts.short) {
    return m === "marginal" ? "Bracketed" : "Retroactive"
  }
  // Bug #23 (2026-05-11, Vick): "Tiered (Per-slice / Marginal)" was
  // confusing — every tiered rebate is, definitionally, tiered, so
  // the label said nothing useful. Rename to "Bracketed" (the rate
  // applies bracket-by-bracket) which actually distinguishes it from
  // Retroactive (one rate applied to all dollars).
  return m === "marginal"
    ? "Bracketed (rate per tier band)"
    : "Retroactive (best tier rate × all dollars)"
}

/**
 * One-line explanation of what each method does. Safe for inclusion
 * in the renewal-brief LLM prompt (won't bias the model since it
 * describes mechanics, not recommendations) and for help tooltips.
 */
export function describeRebateMethod(
  method: RebateMethodName | string | null | undefined,
): string {
  const m = (method ?? "cumulative") as RebateMethodName
  return m === "marginal"
    ? "Each tier's rate applies only to dollars in that bracket. Tier 1 rate pays on the first slice, tier 2 rate pays on the next slice, etc. (e.g. $200K × 5% + $1.06M × 10% = $116,040 on $1.26M)."
    : "Once the top tier is reached, that tier's rate applies to the whole spend (e.g. $1.26M × 10% = $126,040 on $1.26M). Aka 'Dollar 1' or 'cumulative.'"
}
