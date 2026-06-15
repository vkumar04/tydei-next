/**
 * Demo-data payor assignment for case imports.
 *
 * Why (Vick 2026-06-15): the demo case export has no payor/insurance
 * column, so every imported case lands with `payorClass = null` → the
 * Surgeons-tab payor mix and Facility payor mix render "No payor data".
 * A manual DB backfill reverts on every re-import. Assign at IMPORT time
 * instead so the payor surfaces stay populated durably.
 *
 * Conservative by design — only fires when the WHOLE upload has NO payor
 * data (every case's payorClass is blank). If the file carries a payor
 * column at all, we return `null` and keep exactly what was uploaded (and
 * leave individual blanks blank — never fabricate over real data).
 *
 * The assigned mix is a realistic ASC distribution (weighted toward
 * commercial, with a Medicare/Medicaid tail) using raw carrier strings the
 * read-time `classifyPayorClass` already buckets. Deterministic per
 * caseNumber so it's stable across re-imports.
 */

// 100-slot weighted distribution (~46% commercial, ~31% Medicare,
// ~9% Medicaid, ~5% private/self-pay, ~5% workers' comp, ~4% other).
const PAYOR_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["Anthem BCBS", 20],
  ["Aetna", 10],
  ["UnitedHealthcare", 9],
  ["Cigna", 6],
  ["Commercial", 3],
  ["Medicare", 18],
  ["Medicare Advantage", 10],
  ["Medicaid", 10],
  ["Self-Pay", 5],
  ["Workers Comp", 5],
  ["Tricare", 4],
]

const DISTRIBUTION: readonly string[] = PAYOR_WEIGHTS.flatMap(([name, n]) =>
  Array.from({ length: n }, () => name),
) // length 100

/** Stable, deterministic slot in [0, 100) from a case number. */
function slotFor(caseNumber: string): number {
  let h = 0
  for (let i = 0; i < caseNumber.length; i++) {
    h = (h * 31 + caseNumber.charCodeAt(i)) >>> 0
  }
  return h % 100
}

export interface PayorCaseInput {
  caseNumber: string
  payorClass?: string | null
}

/**
 * Returns a `caseNumber → raw payor string` map when the upload carries no
 * payor data at all, or `null` when at least one case already has a payor
 * (so real data is never overwritten).
 */
export function computeMissingPayorAssignment(
  cases: PayorCaseInput[],
): Map<string, string> | null {
  if (cases.length === 0) return null
  const anyPayor = cases.some((c) => (c.payorClass ?? "").trim() !== "")
  if (anyPayor) return null

  const map = new Map<string, string>()
  for (const c of cases) {
    map.set(c.caseNumber, DISTRIBUTION[slotFor(c.caseNumber)])
  }
  return map
}
