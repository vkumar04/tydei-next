export interface CogRowFingerprint {
  id: string
  vendorItemNo: string | null
  description: string
  transactionDate: Date
  extendedPrice: number
}

export interface FuzzyDuplicatePair {
  a: CogRowFingerprint
  b: CogRowFingerprint
  reasons: string[]
}

const PRICE_TOLERANCE = 0.05 // ±5%
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_TOLERANCE_DAYS = 7

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return d[m][n]
}

function descriptionSimilar(a: string, b: string): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
  const an = norm(a), bn = norm(b)
  const maxLen = Math.max(an.length, bn.length)
  if (maxLen === 0) return false
  const dist = levenshtein(an, bn)
  return dist / maxLen <= 0.2 // ≤20% character difference
}

function priceSimilar(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false
  const diff = Math.abs(a - b) / Math.max(a, b)
  return diff <= PRICE_TOLERANCE
}

function dateSimilar(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= DATE_TOLERANCE_DAYS * DAY_MS
}

export function findFuzzyDuplicates(rows: CogRowFingerprint[]): FuzzyDuplicatePair[] {
  const out: FuzzyDuplicatePair[] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      // Skip exact dupes (the deterministic detector already catches those).
      if (a.vendorItemNo && b.vendorItemNo && a.vendorItemNo === b.vendorItemNo &&
          a.transactionDate.getTime() === b.transactionDate.getTime() &&
          a.extendedPrice === b.extendedPrice) continue

      const reasons: string[] = []
      if (descriptionSimilar(a.description, b.description)) reasons.push("description match")
      if (priceSimilar(a.extendedPrice, b.extendedPrice)) reasons.push("price within 5%")
      if (dateSimilar(a.transactionDate, b.transactionDate)) reasons.push("date within 7d")

      // Require at least 2 of the 3 signals AND vendor item match (or both null).
      if (reasons.length >= 2 && (a.vendorItemNo === b.vendorItemNo)) {
        out.push({ a, b, reasons })
      }
    }
  }
  return out
}
