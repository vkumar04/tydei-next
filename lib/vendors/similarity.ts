/**
 * Pure vendor-name similarity + dedup-advisor helpers.
 *
 * Shared between deterministic flows (CSV import, bulk resolvers) and
 * AI-driven flows (vendorDedupProposalPrompt). This module is pure —
 * no prisma, no network, no side effects. Given a raw vendor name and
 * a candidate list, it proposes the most likely matches, but never
 * creates or mutates vendors. Callers decide what to do with the
 * proposals.
 */

/**
 * Levenshtein distance — standard DP implementation, O(n×m).
 *
 * Returns the minimum number of single-character insertions,
 * deletions, or substitutions required to transform `a` into `b`.
 */
export function levenshtein(a: string, b: string): number {
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n

  // Two-row rolling buffer to keep memory O(min(n, m))
  let prev = new Array<number>(m + 1)
  let curr = new Array<number>(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j

  for (let i = 1; i <= n; i++) {
    curr[0] = i
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      )
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }

  return prev[m]
}

/**
 * Case-insensitive similarity ratio 0-1 based on Levenshtein.
 *   1 - distance / max(|a|, |b|)
 * Handles empty strings — both empty returns 1; one empty returns 0.
 */
export function similarityRatio(a: string, b: string): number {
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  if (aLower.length === 0 && bLower.length === 0) return 1
  if (aLower.length === 0 || bLower.length === 0) return 0

  const distance = levenshtein(aLower, bLower)
  const maxLen = Math.max(aLower.length, bLower.length)
  return 1 - distance / maxLen
}

// Common corporate suffixes stripped during normalization. Order is
// not load-bearing because we loop until no match remains — so
// "Acme Corp, Inc." collapses to "acme" regardless of pass order.
const CORPORATE_SUFFIXES = [
  "incorporated",
  "corporation",
  "limited",
  "company",
  "inc",
  "llc",
  "corp",
  "ltd",
  "co",
]

/**
 * Normalize a vendor name for fuzzy matching: lowercase, strip
 * common corporate suffixes (inc, llc, corp, co, ltd), collapse
 * internal whitespace, trim.
 */
export function normalizeVendorName(name: string): string {
  let out = name.toLowerCase()
  // Replace punctuation with spaces so suffix tokens separate cleanly
  out = out.replace(/[.,/#!?$%^&*;:{}=\-_`~()'"]/g, " ")

  // Repeatedly strip trailing corporate suffix tokens. Loop so names
  // like "Acme Corp Inc" collapse across multiple passes.
  let changed = true
  while (changed) {
    changed = false
    out = out.trim().replace(/\s+/g, " ")
    for (const suffix of CORPORATE_SUFFIXES) {
      const re = new RegExp(`(^|\\s)${suffix}$`)
      if (re.test(out)) {
        out = out.replace(re, "").trim()
        changed = true
      }
    }
  }

  return out.replace(/\s+/g, " ").trim()
}

export interface VendorCandidate {
  id: string
  name: string
  /** Optional aliases that also represent this vendor. */
  aliases?: string[]
}

export interface VendorMatchProposal {
  candidate: VendorCandidate
  /** Similarity 0-1, max across name + aliases. */
  confidence: number
  /** Reason the match was proposed (e.g. "name match", "alias match"). */
  reason: string
}

/**
 * Given a raw input name + a list of vendor candidates, propose the
 * top-N matches by normalized similarity. Does NOT create vendors —
 * strictly advisory. Returns empty array when no candidate exceeds
 * `minConfidence` (default 0.7).
 */
export function proposeVendorMatches(
  input: string,
  candidates: VendorCandidate[],
  options: { topN?: number; minConfidence?: number } = {},
): VendorMatchProposal[] {
  const topN = options.topN ?? 5
  const minConfidence = options.minConfidence ?? 0.7

  const normalizedInput = normalizeVendorName(input)
  if (!normalizedInput) return []

  const proposals: VendorMatchProposal[] = []

  for (const candidate of candidates) {
    const nameScore = similarityRatio(normalizedInput, normalizeVendorName(candidate.name))
    let bestScore = nameScore
    let bestReason = "name match"

    for (const alias of candidate.aliases ?? []) {
      const aliasScore = similarityRatio(normalizedInput, normalizeVendorName(alias))
      if (aliasScore > bestScore) {
        bestScore = aliasScore
        bestReason = `alias match (${alias})`
      }
    }

    if (bestScore >= minConfidence) {
      proposals.push({
        candidate,
        confidence: bestScore,
        reason: bestReason,
      })
    }
  }

  proposals.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    // Stable tie-break: candidate.id ascending
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0
  })

  return proposals.slice(0, topN)
}
