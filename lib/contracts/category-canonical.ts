/**
 * Category-name canonicalization (Bug 2026-05-20 Vick: "If I have two
 * contracts and category with one is Ortho Joint and the other is
 * Joint Ortho, there needs to be a mechanism for those to be looked
 * at as the same for market share etc…").
 *
 * Strategy: lowercase, normalize separators ([-_/&] → space), strip
 * non-alphanumeric, split on whitespace, drop noise tokens, sort the
 * remaining tokens, join with a single space.
 *
 * Examples that collapse:
 *   "Ortho Joint"          → "joint ortho"
 *   "Joint Ortho"          → "joint ortho"
 *   "Ortho-Joint"          → "joint ortho"
 *   "ortho/joint"          → "joint ortho"
 *   "  Ortho Joint  "      → "joint ortho"
 *
 * Examples that stay distinct (different non-noise tokens):
 *   "Ortho Sports Med"     → "med ortho sports"
 *   "Ortho Joint"          → "joint ortho"
 *
 * Use at every comparison boundary — JS aggregation, IN-clause
 * expansion — but NOT as the persisted display label. The UI should
 * keep showing the first-seen original form so users recognize the
 * label they typed.
 */

const NOISE_TOKENS = new Set([
  "the",
  "and",
  "of",
  "for",
  "a",
  "an",
])

/**
 * Strip a trailing "s" for plural tokens (length > 3 chars) so
 * "implant" and "implants" collapse. Skips short tokens to avoid
 * mangling "abs" / "hrs" style abbreviations.
 */
function lemmatize(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1)
  }
  return token
}

export function canonicalizeCategoryName(input: string | null | undefined): string {
  if (!input) return ""
  // Vick 2026-05-31 bug doc (Market Share by Category showing 10
  // near-identical rows like "Supplies & Materials;Implants;Total
  // Joint" alongside "Supplies & Materials;Implant;Total Joint"):
  // the prior canonicalizer kept duplicate tokens AND was
  // singular/plural-blind, so any vendor-export with semicolon-
  // joined category strings (Stryker, J&J) blew up into a long
  // list of bucket variants. New rules:
  //   - split on separator chars then ALL non-alphanumeric
  //   - lemmatize each token (drop trailing -s for len>3 non-ss)
  //   - de-dupe tokens (Set) — `implants implants` → `implants`
  //   - sort and join
  //
  // bugs.rtfd 2026-06-13 (Market Share by Category "Still have all these
  // categories"): vendor exports sometimes DROP the delimiter entirely,
  // concatenating two words at a case boundary — "Supplies & MaterialsOR
  // Supplies & Materials", "...MaterialsImplants:Total Joint", "Surgical
  // InstrumentationSurgical Instrumentation". `:`/`;` variants already
  // collapse (they normalize to spaces), but a missing delimiter leaves
  // "materialsor"/"materialsimplants" as one token that never matched its
  // properly-delimited twin. Insert a space at lowercase/digit→Uppercase
  // boundaries (and acronym→Word boundaries) BEFORE lowercasing so these
  // collapse with their delimited form. Verified on prod: 22→18 buckets,
  // merging only the genuine concatenation artifacts (a leading-letter typo
  // like "SSupplies" still stays distinct — it gains a stray "s" token).
  const tokens = input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[\-_/&;,]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t))
    .map(lemmatize)
  return Array.from(new Set(tokens)).sort().join(" ")
}

/**
 * Group display names by their canonical form. Useful when expanding
 * one contract's categories into "all stored variants that should be
 * treated as the same category" — feed both lists into this and pick
 * out the variants whose canonical matches your contract's canonical.
 */
export function bucketByCanonical<T extends { name: string }>(
  items: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const key = canonicalizeCategoryName(item.name)
    if (!key) continue
    const list = out.get(key) ?? []
    list.push(item)
    out.set(key, list)
  }
  return out
}

/**
 * Bucket name for COG rows with no category (Analysis dashboard). A
 * first-class category row — without it the headline spend included
 * uncategorized rows while the Category table's shares didn't, so the
 * table never reconciled to the card (review 2026-08-05). Chosen so
 * `canonicalizeCategoryName` cannot produce it from real data
 * (parentheses are stripped by canonicalization). Lives here, not in the
 * "use server" loader, because every export there must be an async
 * function (use-server-async-export-scanner).
 */
export const UNCATEGORIZED_CATEGORY = "(uncategorized)"
