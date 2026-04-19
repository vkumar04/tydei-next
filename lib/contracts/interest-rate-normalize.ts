/**
 * Interest-rate normalization helpers (Charles W1.E).
 *
 * Context: `ContractTerm.interestRate` is stored as a FRACTION
 * (0.04 = 4% APR), matching the `ContractTier.rebateValue` convention
 * (0.02 = 2%). The amortization engine in
 * `lib/rebates/engine/amortization.ts` interprets the value as
 * fractional APR (`r = interestRate / periodsPerYear`). The tie-in
 * capital entry form historically stored raw user input verbatim, so a
 * user typing "4" for 4% APR got persisted as 4.0 — which the engine
 * then treated as 400% APR → every row's Interest Charge equalled the
 * opening balance (100% per period on a quarterly schedule).
 *
 * These helpers keep the UI in whole-percent and the DB in fraction,
 * with a single one-spot mapping. Mirrors the pattern established in
 * `lib/contracts/rebate-value-normalize.ts` (R5.25).
 */

/**
 * Convert a stored `interestRate` (fraction) into the number the user
 * should see in the whole-percent input field. 0.04 → 4.
 */
export function toDisplayInterestRate(interestRate: number): number {
  // Round to 6 decimals to avoid floating-point fuzz
  // (e.g. 0.0525 * 100 = 5.25 exactly, but 0.035 * 100 = 3.5000000000000004).
  return Math.round(interestRate * 100 * 1_000_000) / 1_000_000
}

/**
 * Convert a whole-percent value the user typed into the stored
 * fraction the DB expects. 4 → 0.04.
 */
export function fromDisplayInterestRate(displayValue: number): number {
  return displayValue / 100
}

/**
 * Normalize an interest rate coming from an ingestion / AI pipeline.
 *
 * AI models and CSV imports often return "4" for "4%"; older
 * extractions may already be fraction-denominated (0.04). Treat any
 * value > 1 as "whole percent" and divide by 100. Values ≤ 1 are
 * assumed already-fractional and pass through. `null`/`undefined`
 * collapse to 0.
 *
 * This heuristic is the same class R5.25 uses for `rebateValue`. It
 * will incorrectly pass through any legitimate > 100% APR (not a real
 * case in healthcare contracts) and any < 1% APR that an ingest
 * source happens to deliver as a fraction (e.g. "0.5" meaning 0.5%).
 * The latter is resolved by callers that know their source — this
 * helper is only for sources that historically mixed the two.
 */
export function normalizeAIInterestRate(
  interestRate: number | null | undefined,
): number {
  const v = interestRate ?? 0
  if (v > 1) return v / 100
  return v
}
