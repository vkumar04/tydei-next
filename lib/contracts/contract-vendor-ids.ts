/**
 * The contract's full participating vendor set (#2, Vick 2026-05-31).
 *
 * A grouped contract (`isGrouped` + `additionalVendorIds[]`) is ONE
 * agreement spanning several vendors. Spend, rebate accrual, compliance,
 * and market share must all aggregate across every participating vendor —
 * not just the primary `vendorId`. This is the single definition of "which
 * vendors does this contract cover"; every group-aware query reads it so
 * the surfaces can't drift.
 *
 * Returns `[vendorId, ...additionalVendorIds]` de-duped, with null/empty
 * dropped. An empty result (no primary vendor, no additionals) means the
 * caller should fall back to its existing no-vendor behavior.
 */
export function contractVendorIds(contract: {
  vendorId: string | null
  additionalVendorIds?: string[] | null
}): string[] {
  const ids = new Set<string>()
  if (contract.vendorId) ids.add(contract.vendorId)
  for (const v of contract.additionalVendorIds ?? []) {
    if (v) ids.add(v)
  }
  return Array.from(ids)
}
