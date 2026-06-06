/**
 * E4 (Charles 2026-06-06) — minimum-annual-purchase selection.
 *
 * Pure helper extracted from `getContractCapitalSchedule` in
 * `lib/actions/contracts/tie-in.ts`. It lives in a plain (non-`"use
 * server"`) module so it can be exported synchronously and unit-tested
 * directly — `"use server"` files may only export async functions.
 *
 * Rule: when multiple terms carry a `minimumPurchaseCommitment`, surface
 * the LOWEST positive value (was: largest). Record the `source`
 * (`commitment` vs the `spendBaseline` fallback) and count how many
 * positive commitments existed so the UI can disclose "lowest of N".
 * Falls back to the lowest positive `spendBaseline` when no term carries
 * an explicit commitment (E1: baseline acts as the floor).
 */

/**
 * Numeric-ish input: a plain `number`, `null`, or a Prisma `Decimal`
 * (which carries a `toString()`/`valueOf()` and coerces cleanly through
 * `Number()`). Typed structurally so this stays a pure module with no
 * Prisma import.
 */
export type MinAnnualPurchaseValue = number | { toString(): string } | null

export interface MinAnnualPurchaseTerm {
  minimumPurchaseCommitment: MinAnnualPurchaseValue
  spendBaseline: MinAnnualPurchaseValue
}

export interface MinAnnualPurchaseSelection {
  value: number | null
  source: "commitment" | "baseline" | null
  commitmentCount: number
}

export function selectMinAnnualPurchase(
  terms: ReadonlyArray<MinAnnualPurchaseTerm>,
): MinAnnualPurchaseSelection {
  let value: number | null = null
  let source: "commitment" | "baseline" | null = null
  let commitmentCount = 0

  for (const t of terms) {
    if (t.minimumPurchaseCommitment == null) continue
    const n = Number(t.minimumPurchaseCommitment)
    if (!Number.isFinite(n) || n <= 0) continue
    commitmentCount++
    if (value == null || n < value) {
      value = n
      source = "commitment"
    }
  }

  if (value == null) {
    for (const t of terms) {
      if (t.spendBaseline == null) continue
      const n = Number(t.spendBaseline)
      if (!Number.isFinite(n) || n <= 0) continue
      if (value == null || n < value) {
        value = n
        source = "baseline"
      }
    }
  }

  return { value, source, commitmentCount }
}
