/**
 * Pure, dependency-free text utilities used by the document-indexing
 * pipeline (subsystem 2 of the AI Agent rewrite). No prisma, no I/O.
 *
 * Kept split from `document-search.ts` so the same helpers can be reused
 * by whichever indexer variant (pgvector or FTS) ends up populating
 * `ContractDocumentPage` rows.
 */

export interface ExtractedPage {
  pageNumber: number
  text: string
}

/**
 * Split raw text into pages using form-feed (`\f`) or an explicit
 * page separator (`<<<PAGE_BREAK>>>`). If no separator is found the
 * entire input is returned as a single page.
 *
 * Page numbers are 1-indexed. Empty trailing / leading segments caused
 * by a separator at the very start or end are preserved so that page
 * numbering matches the source document exactly.
 */
export function splitTextIntoPages(rawText: string): ExtractedPage[] {
  if (rawText.length === 0) {
    return [{ pageNumber: 1, text: "" }]
  }

  // Accept either a literal form-feed or an explicit textual marker.
  // The regex is intentionally greedy per-boundary to avoid dropping
  // content between adjacent separators.
  const separator = /\f|<<<PAGE_BREAK>>>/
  if (!separator.test(rawText)) {
    return [{ pageNumber: 1, text: rawText }]
  }

  const parts = rawText.split(separator)
  return parts.map((text, idx) => ({
    pageNumber: idx + 1,
    text,
  }))
}

/**
 * Normalize page text by:
 *   1. Collapsing runs of whitespace (including newlines) to a single space.
 *   2. Trimming leading/trailing whitespace.
 *   3. Removing repeated headers/footers — lines that appear at the SAME
 *      positional index (top-N or bottom-N) of three or more pages.
 *
 * Header/footer detection works on the raw (pre-collapse) input: a line
 * is a candidate if it appears at position 0 (top) or position -1
 * (bottom) in at least three pages. This mirrors how PDF extractors
 * preserve per-page line layout.
 */
export function normalizePageText(pages: ExtractedPage[]): ExtractedPage[] {
  if (pages.length === 0) return []

  // Build line arrays per page for positional analysis. Blank lines are
  // kept so positional indexing stays accurate relative to the source.
  const pageLines: string[][] = pages.map((p) =>
    p.text.split(/\r?\n/).map((l) => l.trim()),
  )

  // Count occurrences of (positionKey, lineText). positionKey is either
  // "top" (index 0) or "bottom" (last non-empty line).
  const topCounts = new Map<string, number>()
  const bottomCounts = new Map<string, number>()

  for (const lines of pageLines) {
    const firstNonEmpty = lines.find((l) => l.length > 0)
    if (firstNonEmpty) {
      topCounts.set(firstNonEmpty, (topCounts.get(firstNonEmpty) ?? 0) + 1)
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const candidate = lines[i]
      if (candidate && candidate.length > 0) {
        bottomCounts.set(candidate, (bottomCounts.get(candidate) ?? 0) + 1)
        break
      }
    }
  }

  const repeatedTops = new Set<string>()
  for (const [line, count] of topCounts) {
    if (count >= 3) repeatedTops.add(line)
  }
  const repeatedBottoms = new Set<string>()
  for (const [line, count] of bottomCounts) {
    if (count >= 3) repeatedBottoms.add(line)
  }

  return pages.map((page, idx) => {
    const lines = pageLines[idx]
    const filtered: string[] = []
    let topStripped = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!topStripped && line.length === 0) {
        // skip leading blanks while searching for the top line
        continue
      }
      if (!topStripped) {
        topStripped = true
        if (repeatedTops.has(line)) {
          // drop this top line
          continue
        }
      }
      filtered.push(line)
    }

    // Strip a repeated bottom line if present (last non-empty).
    for (let i = filtered.length - 1; i >= 0; i--) {
      const line = filtered[i]
      if (line.length === 0) continue
      if (repeatedBottoms.has(line)) {
        filtered.splice(i, 1)
      }
      break
    }

    const joined = filtered.join(" ")
    const collapsed = joined.replace(/\s+/g, " ").trim()

    return {
      pageNumber: page.pageNumber,
      text: collapsed,
    }
  })
}
