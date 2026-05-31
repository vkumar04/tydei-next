/**
 * Carve-out scope lock predicate (Vick 2026-05-31 #3).
 *
 * Carve-out terms derive their product scope and per-SKU rebate from the
 * pricing file's carve-out % column — the rebate engine
 * (lib/contracts/recompute/carve-out.ts) reads
 * `ContractPricing.carveOutPercent` per SKU and ignores `appliesTo` and the
 * manual `ContractTermProduct` picker. So the term editor shows scope
 * controls locked/read-only for these terms rather than letting the user
 * configure something the engine will not read.
 *
 * One source of truth so the UI and any future server-side guard agree.
 */
export function isCarveOutScopeLocked(termType: string | null | undefined): boolean {
  return termType === "carve_out"
}
