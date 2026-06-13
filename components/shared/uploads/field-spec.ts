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

/**
 * How a field's header was resolved (feature 3, uploader improvement 3):
 * - "exact"    — a header's norm() equals an alias's norm()
 * - "contains" — a header contains a `contains` needle
 * - "fuzzy"    — a header is a bounded-edit-distance near-miss of an alias
 *                (the dropzone flags these with a "best guess" badge so the
 *                user verifies before importing)
 * - null       — the field did not resolve to any header
 */
export type MappingProvenance = "exact" | "contains" | "fuzzy" | null

export interface MappingProvenanceMap {
  [fieldKey: string]: MappingProvenance
}

export interface ResolveMappingResult {
  mapping: ResolvedMapping
  /** keys of required specs that did not auto-resolve */
  missingRequired: string[]
  /** per-field record of HOW each field resolved (feature 3) */
  provenance: MappingProvenanceMap
}

/**
 * Bounded Damerau–Levenshtein edit distance (feature 3). Counts
 * insertions, deletions, substitutions, AND adjacent transpositions
 * (so "Referance" → "Reference" is distance 1, a single substitution;
 * "Pirce" → "Price" is distance 1, a transposition — exactly the typo
 * classes real vendor headers exhibit). Returns early once the running
 * minimum exceeds `max`, so we never pay for distances we'd reject.
 *
 * Implemented locally — no new dependency (conventions: no new deps).
 */
export function boundedDamerauLevenshtein(
  a: string,
  b: string,
  max: number,
): number {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  // A length gap alone already exceeds the bound — bail.
  if (Math.abs(la - lb) > max) return max + 1
  if (la === 0) return lb
  if (lb === 0) return la

  // Three rolling rows: prev-prev (for transpositions), prev, and current.
  let prevPrev: number[] = []
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j)
  let curr: number[] = Array.from({ length: lb + 1 }, () => 0)

  for (let i = 1; i <= la; i++) {
    curr[0] = i
    let rowMin = curr[0]!
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let val = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      )
      // Transposition of two adjacent characters.
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        val = Math.min(val, prevPrev[j - 2]! + 1)
      }
      curr[j] = val
      if (val < rowMin) rowMin = val
    }
    // Whole row already past the bound — no later row can recover.
    if (rowMin > max) return max + 1
    prevPrev = prev
    prev = curr
    curr = Array.from({ length: lb + 1 }, () => 0)
  }
  return prev[lb]!
}

/**
 * Fuzzy match threshold for an alias of normalized length `len`
 * (feature 3): never fuzzy-match aliases shorter than 4 chars (too many
 * unrelated short headers collide — e.g. "qty" vs "uom"); distance ≤1 for
 * aliases ≤6 chars; ≤2 for longer aliases (one extra slot of slack scales
 * with the word). Returns null when the alias is too short to fuzzy-match.
 */
function fuzzyThresholdForAlias(len: number): number | null {
  if (len < 4) return null
  return len <= 6 ? 1 : 2
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
 * - A THIRD fuzzy pass (feature 3) bounded-edit-distance matches the
 *   STILL-unmapped fields against unclaimed headers, so single-character
 *   typos ("Referance Number", "Pric") resolve. Ambiguity is never
 *   guessed through: if two headers tie for a field, or two fields want
 *   the same header, neither is taken.
 */
export function resolveMapping(
  headers: string[],
  specs: UploadFieldSpec[],
): ResolveMappingResult {
  const normHeaders = headers.map(norm)
  const claimed = new Set<number>()
  const mapping: ResolvedMapping = {}
  const provenance: MappingProvenanceMap = {}
  for (const spec of specs) provenance[spec.key] = null

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
    if (found >= 0) {
      claimed.add(found)
      provenance[spec.key] = "exact"
    }
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
      provenance[spec.key] = "contains"
    }
  }

  // Pass 3: fuzzy fallback (feature 3). For each still-unmapped field we
  // find the closest unclaimed header within the per-alias threshold. We
  // compute ALL candidate pairs first, then resolve, so we can detect two
  // ambiguity classes and refuse to guess through either:
  //   (a) one field's best two headers tie on distance → skip the field
  //   (b) two fields both want the SAME header → skip both
  // Never fuzzy-match short aliases (fuzzyThresholdForAlias returns null).
  interface FuzzyPick {
    specKey: string
    headerIdx: number
    distance: number
    /** true when ≥2 headers tied at this field's best distance */
    ambiguousWithinField: boolean
  }
  const picks: FuzzyPick[] = []
  for (const spec of specs) {
    if (mapping[spec.key] !== null) continue
    let bestIdx = -1
    let bestDist = Infinity
    let tie = false
    for (let i = 0; i < normHeaders.length; i++) {
      const h = normHeaders[i]!
      if (h === "" || claimed.has(i)) continue
      // Best (smallest) distance from this header to ANY of the field's
      // aliases, each alias bounded by its own length-based threshold.
      let headerDist = Infinity
      for (const alias of spec.aliases) {
        const a = norm(alias)
        const threshold = fuzzyThresholdForAlias(a.length)
        if (threshold === null) continue
        const d = boundedDamerauLevenshtein(h, a, threshold)
        if (d <= threshold && d < headerDist) headerDist = d
      }
      if (headerDist === Infinity) continue
      if (headerDist < bestDist) {
        bestDist = headerDist
        bestIdx = i
        tie = false
      } else if (headerDist === bestDist) {
        // Two headers equidistant for this field → ambiguous.
        tie = true
      }
    }
    if (bestIdx >= 0) {
      picks.push({
        specKey: spec.key,
        headerIdx: bestIdx,
        distance: bestDist,
        ambiguousWithinField: tie,
      })
    }
  }
  // Detect headers wanted by ≥2 fields → drop every contender for that
  // header (cross-field ambiguity; never guess through it).
  const headerWantCount = new Map<number, number>()
  for (const p of picks) {
    headerWantCount.set(p.headerIdx, (headerWantCount.get(p.headerIdx) ?? 0) + 1)
  }
  for (const p of picks) {
    if (p.ambiguousWithinField) continue
    if ((headerWantCount.get(p.headerIdx) ?? 0) > 1) continue
    // Safe to claim — no within-field tie, no cross-field contention.
    if (claimed.has(p.headerIdx)) continue
    mapping[p.specKey] = headers[p.headerIdx]!
    claimed.add(p.headerIdx)
    provenance[p.specKey] = "fuzzy"
  }

  const missingRequired = specs
    .filter((s) => s.required && mapping[s.key] === null)
    .map((s) => s.key)

  return { mapping, missingRequired, provenance }
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
