/**
 * Rebate-value normalization helpers (Charles R5.25).
 *
 * Context: `ContractTier.rebateValue` is stored as a FRACTION for
 * percent-of-spend tiers (0.02 = 2%). The canonical rebate engine in
 * `lib/contracts/rebate-method.ts` expects INTEGER PERCENT (2 = 2%);
 * `computeRebateFromPrismaTiers` bridges that by multiplying × 100 at
 * the Prisma boundary. Non-percent rebate types (`fixed_rebate`,
 * `fixed_rebate_per_unit`, `per_procedure_rebate`) store plain dollar
 * amounts — no scaling.
 *
 * The form layer historically stored whatever the user typed verbatim,
 * so a user typing "3" for 3% got persisted as 3.0 — which the engine
 * then treated as 300% → 100× inflated rebates. These helpers keep the
 * UI in percent and the DB in fraction, with a one-spot mapping.
 */

/** Rebate types that are expressed as a percentage (stored as fraction). */
const PERCENT_REBATE_TYPES = new Set([
  "percent_of_spend",
])

export function isPercentRebateType(rebateType: string): boolean {
  return PERCENT_REBATE_TYPES.has(rebateType)
}

/**
 * Convert a stored `rebateValue` into the number the user should see in
 * the form. For percent_of_spend we denormalize fraction → percent
 * (0.03 → 3). For dollar-denominated rebate types the value passes
 * through unchanged.
 */
export function toDisplayRebateValue(
  rebateType: string,
  rebateValue: number,
): number {
  if (!isPercentRebateType(rebateType)) return rebateValue
  // Round to avoid floating-point fuzz like 0.03 * 100 = 3.0000000000000004
  return Math.round(rebateValue * 100 * 1_000_000) / 1_000_000
}

/**
 * Convert a percent value the user typed into the stored fraction the
 * DB expects. For percent_of_spend (3 → 0.03); dollar rebate types
 * pass through.
 */
export function fromDisplayRebateValue(
  rebateType: string,
  displayValue: number,
): number {
  if (!isPercentRebateType(rebateType)) return displayValue
  return displayValue / 100
}

/**
 * Normalize a rebate value coming from the AI extraction pipeline.
 *
 * AI models often return "3" for "3%"; older extractions sometimes
 * returned 0.03. Treat any percent-of-spend value > 1 as "whole
 * percent" and divide by 100. Values ≤ 1 are assumed already-fraction
 * and pass through. Dollar rebate types always pass through.
 *
 * Callers push the output of this function directly into the form
 * state, which lives in the same percent-denominated space as the
 * input field. That means: an AI that returns 3 → we store 0.03 as
 * the *fraction*, then the form re-renders it as 3% via
 * `toDisplayRebateValue`. An AI that returns 0.03 → we keep 0.03,
 * form shows 3%. Either way the ledger math stays correct.
 */
export function normalizeAIRebateValue(
  rebateType: string,
  rebateValue: number | null | undefined,
): number {
  const v = rebateValue ?? 0
  if (!isPercentRebateType(rebateType)) return v
  if (v > 1) return v / 100
  return v
}
