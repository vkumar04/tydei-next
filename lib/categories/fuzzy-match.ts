/**
 * Fuzzy matching for Category names on the contract form.
 *
 * Charles R5.17: when a user types a NEW category name that looks
 * similar to an existing one (e.g. "Trauma Implants" vs existing
 * "Trauma"), suggest reusing the existing one before creating a
 * fresh row. Keeps category list consolidated across contracts.
 */

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim()
}

/** Classic Levenshtein distance, small & inline (no new deps). */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

export interface CategorySuggestion {
  id: string
  name: string
  similarity: number
}

/**
 * Return the best similar existing category, or null if nothing is
 * close enough. Matches when:
 *   - normalized Levenshtein distance <= 2, OR
 *   - one normalized name contains the other AND both are >=3 chars
 *     (so "Trauma Implants" suggests existing "Trauma").
 * Exact matches return null — caller already handles those by id.
 */
export function suggestSimilarCategory(
  input: string,
  existing: { id: string; name: string }[],
): CategorySuggestion | null {
  const needle = normalize(input)
  if (needle.length < 3) return null

  let best: CategorySuggestion | null = null
  for (const cat of existing) {
    const hay = normalize(cat.name)
    if (hay.length < 3) continue
    if (hay === needle) return null // exact (case/punctuation insensitive)

    const dist = levenshtein(needle, hay)
    const maxLen = Math.max(needle.length, hay.length)
    const similarity = maxLen === 0 ? 0 : (maxLen - dist) / maxLen

    const contains = needle.includes(hay) || hay.includes(needle)
    const closeEnough = dist <= 2 || contains

    if (closeEnough && (!best || similarity > best.similarity)) {
      best = { id: cat.id, name: cat.name, similarity }
    }
  }
  return best
}
