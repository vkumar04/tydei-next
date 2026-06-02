/**
 * Category auto-suggest scorer (Bug 1/10 follow-up, Vick 2026-06-02).
 *
 * Pure helpers — kept out of the "use server" cog-category-mapping.ts
 * (which may only export async functions). Proposes a canonical
 * ProductCategory for a raw COG/price-file category by token overlap,
 * so the Category Mapping dialog can pre-fill a target the user just
 * confirms instead of typing.
 */

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

// Generic/structural tokens that shouldn't drive a match on their own.
const STOP = new Set(["and", "the", "of", "ortho", "general"])

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
}

/**
 * Token-overlap score 0..1 = matched / raw-token-count. Tokens match
 * exactly or by 4+ char prefix, so "Sports Med" hits "Sports Medicine"
 * and "Joints-Ortho" hits "Joint Replacement".
 */
export function scoreCategoryMatch(raw: string, canonical: string): number {
  const a = tokenize(raw)
  const b = tokenize(canonical)
  if (a.length === 0 || b.length === 0) return 0
  let hit = 0
  for (const ta of a) {
    if (
      b.some(
        (tb) =>
          ta === tb ||
          (ta.length >= 4 && tb.startsWith(ta.slice(0, 4))) ||
          (tb.length >= 4 && ta.startsWith(tb.slice(0, 4))),
      )
    )
      hit++
  }
  return hit / a.length
}

/** Best canonical match at/above 0.5 confidence, or null. */
export function suggestTarget(
  raw: string,
  canonicalNames: string[],
): string | null {
  let best: { name: string; score: number } | null = null
  for (const name of canonicalNames) {
    const score = scoreCategoryMatch(raw, name)
    if (score >= 0.5 && (!best || score > best.score)) best = { name, score }
  }
  return best?.name ?? null
}
