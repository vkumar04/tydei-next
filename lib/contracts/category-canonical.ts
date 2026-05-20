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

export function canonicalizeCategoryName(input: string | null | undefined): string {
  if (!input) return ""
  return input
    .toLowerCase()
    .replace(/[\-_/&]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t))
    .sort()
    .join(" ")
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
