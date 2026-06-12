/**
 * Analysis-vendor precedence + loose vendor-name matching for the proposal
 * analyzer (bug-round 2026-06-12 R2).
 *
 * The bug: the upload tab resolved its working vendor as
 * `lookback?.vendorId ?? selectedVendorId` — the PDF auto-detected vendor
 * ALWAYS beat the user's explicit dropdown pick, so a DePuy PDF dropped
 * alongside an Arthrex price file ran the whole analysis as
 * "Johnson & Johnson" even though the user had selected "Arthrex, Inc."
 *
 * The rule, owned here so every surface agrees:
 *   1. A manual dropdown selection WINS everywhere.
 *   2. PDF auto-detection only fills the gap when nothing is selected.
 *
 * Vendor names are NEVER compared raw (project memory: case-insensitive
 * vendor-name compare everywhere) — `vendorNamesLooselyMatch` lowercases,
 * trims, and tolerates corporate-suffix drift ("Arthrex, Inc." ≈ "Arthrex"),
 * mirroring the server-side resolution in
 * `lib/actions/prospective-analysis.ts` `getVendorLookbackComparison`.
 */

export interface VendorNameOption {
  id: string
  name: string
  displayName: string | null
}

/**
 * The ONE precedence rule: the user's explicit selection wins; the
 * PDF-detected (lookback-resolved) vendor only fills the gap.
 */
export function resolveAnalysisVendorId(
  selectedVendorId: string | null,
  detectedVendorId: string | null,
): string | null {
  return selectedVendorId ?? detectedVendorId
}

/**
 * Canonical form for loose vendor-name comparison: trim, lowercase, strip a
 * trailing corporate suffix (Inc / LLC / Corp / Co / Ltd / Incorporated).
 * Mirrors the server-side suffix handling in `getVendorLookbackComparison`,
 * with one tightening: the suffix must be preceded by punctuation or
 * whitespace, so "Costco" is not mangled to "Cost".
 */
export function normalizeVendorNameLoose(name: string): string {
  return name
    .trim()
    .replace(
      /(?:[,.]\s*|\s+)(incorporated|inc|llc|corp(oration)?|co|ltd)\.?$/i,
      "",
    )
    .trim()
    .toLowerCase()
}

/** Case-insensitive, suffix-tolerant vendor-name equality. */
export function vendorNamesLooselyMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a?.trim() || !b?.trim()) return false
  return normalizeVendorNameLoose(a) === normalizeVendorNameLoose(b)
}

/**
 * Find the dropdown option matching a PDF-detected vendor name —
 * case-insensitive against both `name` and `displayName`, suffix-tolerant.
 * Returns the option only when exactly ONE matches (an ambiguous name must
 * not silently pick an arbitrary vendor — same rule as the server's
 * single-candidate `contains` fallback).
 */
export function matchVendorOptionByName<T extends VendorNameOption>(
  vendors: readonly T[],
  detectedName: string | null | undefined,
): T | null {
  if (!detectedName?.trim()) return null
  const matches = vendors.filter(
    (v) =>
      vendorNamesLooselyMatch(v.name, detectedName) ||
      vendorNamesLooselyMatch(v.displayName, detectedName),
  )
  return matches.length === 1 ? matches[0] : null
}
