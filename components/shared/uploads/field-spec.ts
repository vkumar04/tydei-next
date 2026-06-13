/**
 * Field specs + header→field auto-resolution for the shared
 * <PricingFileDropzone> column-mapping flow (uploader improvements 1+2,
 * 2026-06-13).
 *
 * Pure TS — no React — so resolveMapping is unit-testable in node and
 * reusable by any mapper that needs the same detection convention.
 *
 * Alias lists in specs MUST come from the canonical lists in
 * `lib/utils/parse-pricing-file.ts` (invariants table: "Pricing-file
 * header detection") plus surface-specific extras — never inline a copy
 * of the canonical aliases.
 */

export interface UploadFieldSpec {
  key: string
  /** Human label shown in the mapping dialog, e.g. "Item number". */
  label: string
  /** Canonical + surface extras, in priority order (first match wins). */
  aliases: string[]
  required?: boolean
  kind: "text" | "number" | "date"
  /**
   * Secondary substring pass (normalized `includes`) applied only after
   * EVERY field's exact-alias pass failed for this field. Preserves the
   * legacy contains-fallbacks some surfaces rely on (e.g. the proposal
   * builder's "List Price" → contains "price", usage-file "Date
   * Ordered" → contains "date").
   */
  contains?: string[]
}

/** field key → raw header name claimed for it, or null = not in this file. */
export interface ResolvedMapping {
  [fieldKey: string]: string | null
}

/**
 * Same normalization convention as the canonical detector in
 * lib/utils/parse-pricing-file.ts: lowercase, strip non-alphanumerics.
 */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export interface ResolveMappingResult {
  mapping: ResolvedMapping
  /** keys of required specs that did not auto-resolve */
  missingRequired: string[]
}

/**
 * Auto-resolve file headers to spec fields.
 *
 * Rules:
 * - First-alias-wins per field: aliases are tried in order, the first
 *   header whose norm() equals the alias's norm() is claimed.
 * - Fields resolve in spec order, and a header claimed by an earlier
 *   field is excluded from later fields (mirrors the analyzer's
 *   current-price-before-proposed-price `exclude` convention).
 * - `contains` fallbacks run as a second pass (still in spec order),
 *   only for fields the exact pass left unresolved.
 */
export function resolveMapping(
  headers: string[],
  specs: UploadFieldSpec[],
): ResolveMappingResult {
  const normHeaders = headers.map(norm)
  const claimed = new Set<number>()
  const mapping: ResolvedMapping = {}

  // Pass 1: exact alias matches, spec order, first alias wins.
  for (const spec of specs) {
    let found = -1
    for (const alias of spec.aliases) {
      const a = norm(alias)
      const idx = normHeaders.findIndex(
        (h, i) => h === a && h !== "" && !claimed.has(i),
      )
      if (idx >= 0) {
        found = idx
        break
      }
    }
    mapping[spec.key] = found >= 0 ? headers[found]! : null
    if (found >= 0) claimed.add(found)
  }

  // Pass 2: contains fallbacks for fields the exact pass missed.
  for (const spec of specs) {
    if (mapping[spec.key] !== null || !spec.contains?.length) continue
    const needles = spec.contains.map(norm).filter((n) => n !== "")
    const idx = normHeaders.findIndex(
      (h, i) =>
        h !== "" && !claimed.has(i) && needles.some((n) => h.includes(n)),
    )
    if (idx >= 0) {
      mapping[spec.key] = headers[idx]!
      claimed.add(idx)
    }
  }

  const missingRequired = specs
    .filter((s) => s.required && mapping[s.key] === null)
    .map((s) => s.key)

  return { mapping, missingRequired }
}

/**
 * Header index for a field under a user-supplied mapping override.
 * Mappers call this when `mappingOverride` is provided — the override
 * FULLY replaces auto-detection (null = the user said "Not in this
 * file", so the field stays unmapped even if an alias would match).
 */
export function overrideIndex(
  headers: string[],
  mappingOverride: ResolvedMapping,
  key: string,
): number {
  const header = mappingOverride[key]
  return header ? headers.indexOf(header) : -1
}
