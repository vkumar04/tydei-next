/**
 * Pure in-memory document search (subsystem 3 of the AI Agent rewrite).
 *
 * This module is intentionally prisma-free so it can be unit tested and
 * reused by either the FTS or the pgvector pipeline variant. Callers
 * load `IndexedPage[]` from whatever storage mechanism they prefer,
 * then hand the array to `searchIndexedDocuments` along with a query.
 *
 * The algorithm implements simple AND-semantics term-frequency matching:
 *  - tokenize query into lowercase terms
 *  - for each page, require that *every* term appears at least once
 *  - relevanceScore = sum(occurrences) / page.text.length
 *  - excerpt + context are built around the first matched-term hit
 */

export interface IndexedPage {
  documentId: string
  pageNumber: number
  text: string
  vendor?: string
  documentType?: string
}

export interface SearchHit {
  documentId: string
  pageNumber: number
  matchedText: string
  context: string
  relevanceScore: number
  vendor?: string
  documentType?: string
}

export interface SearchOptions {
  vendorFilter?: string
  documentTypeFilter?: string
  limit?: number
}

const DEFAULT_LIMIT = 20
const MATCHED_TEXT_RADIUS = 50
const CONTEXT_RADIUS = 200

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/**
 * Count non-overlapping case-insensitive occurrences of `needle` in
 * `haystack`. Uses `indexOf` in a loop to avoid RegExp-escape pitfalls
 * with user input.
 */
function countOccurrences(haystackLower: string, needleLower: string): number {
  if (needleLower.length === 0) return 0
  let count = 0
  let from = 0
  while (true) {
    const idx = haystackLower.indexOf(needleLower, from)
    if (idx === -1) break
    count++
    from = idx + needleLower.length
  }
  return count
}

/**
 * Find the earliest occurrence of any term in the page. Returns the
 * index of that occurrence and the matched term's length, or `null`
 * if none of the terms appear.
 */
function firstMatch(
  textLower: string,
  terms: string[],
): { index: number; length: number } | null {
  let earliest: { index: number; length: number } | null = null
  for (const term of terms) {
    const idx = textLower.indexOf(term)
    if (idx === -1) continue
    if (earliest === null || idx < earliest.index) {
      earliest = { index: idx, length: term.length }
    }
  }
  return earliest
}

function sliceAround(
  text: string,
  index: number,
  matchLength: number,
  radius: number,
): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + matchLength + radius)
  return text.slice(start, end)
}

export function searchIndexedDocuments(
  pages: IndexedPage[],
  query: string,
  options?: SearchOptions,
): SearchHit[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []
  if (pages.length === 0) return []

  const vendorFilter = options?.vendorFilter
  const documentTypeFilter = options?.documentTypeFilter
  const limit = options?.limit ?? DEFAULT_LIMIT

  const hits: SearchHit[] = []

  for (const page of pages) {
    if (vendorFilter !== undefined && page.vendor !== vendorFilter) continue
    if (
      documentTypeFilter !== undefined &&
      page.documentType !== documentTypeFilter
    )
      continue

    const textLower = page.text.toLowerCase()
    if (textLower.length === 0) continue

    // AND semantics: every term must occur at least once.
    let totalOccurrences = 0
    let skip = false
    for (const term of terms) {
      const c = countOccurrences(textLower, term)
      if (c === 0) {
        skip = true
        break
      }
      totalOccurrences += c
    }
    if (skip) continue

    const match = firstMatch(textLower, terms)
    if (match === null) continue // defensive; shouldn't happen given AND check

    const matchedText = sliceAround(
      page.text,
      match.index,
      match.length,
      MATCHED_TEXT_RADIUS,
    )
    const context = sliceAround(
      page.text,
      match.index,
      match.length,
      CONTEXT_RADIUS,
    )
    const relevanceScore = totalOccurrences / page.text.length

    const hit: SearchHit = {
      documentId: page.documentId,
      pageNumber: page.pageNumber,
      matchedText,
      context,
      relevanceScore,
    }
    if (page.vendor !== undefined) hit.vendor = page.vendor
    if (page.documentType !== undefined) hit.documentType = page.documentType

    hits.push(hit)
  }

  hits.sort((a, b) => b.relevanceScore - a.relevanceScore)
  return hits.slice(0, limit)
}
