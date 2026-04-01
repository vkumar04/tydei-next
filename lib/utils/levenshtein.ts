/**
 * Levenshtein distance and similarity utilities for fuzzy string matching.
 */

/** Normalize a vendor name for comparison: lowercase, strip suffixes, remove punctuation */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|corp|co|ltd|company|corporation|enterprises|group|lp|l\.p\.|medical|industries)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Compute Levenshtein distance between two strings */
export function levenshteinDistance(a: string, b: string): number {
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
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }

  return dp[m][n]
}

/** Compute similarity as a 0-1 score (1 = identical) */
export function levenshteinSimilarity(a: string, b: string): number {
  const na = normalizeVendorName(a)
  const nb = normalizeVendorName(b)
  if (na === nb) return 1
  if (na.length === 0 || nb.length === 0) return 0

  // Check substring containment
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length)
    const longer = Math.max(na.length, nb.length)
    return shorter / longer
  }

  const dist = levenshteinDistance(na, nb)
  const maxLen = Math.max(na.length, nb.length)
  return (maxLen - dist) / maxLen
}

/** Find best matches for a name from a list of candidates */
export function findBestMatches(
  needle: string,
  haystack: { id: string; name: string }[],
  minSimilarity = 0.4,
  maxResults = 5
): { id: string; name: string; similarity: number }[] {
  const results = haystack
    .map((item) => ({
      ...item,
      similarity: levenshteinSimilarity(needle, item.name),
    }))
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults)

  return results
}
