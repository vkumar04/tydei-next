/**
 * Shared tabular header-row detection (2026-06-13).
 *
 * Extracted VERBATIM from app/api/parse-file/route.ts so the client-side
 * XLSX/XLS reader (components/shared/uploads/read-tabular-file.ts) and the
 * server route share ONE implementation and cannot drift. The only variable
 * between the two surfaces is HOW the `string[][]` matrix is produced
 * (SheetJS in the browser, ExcelJS/SheetJS on the server) — everything
 * downstream of the matrix (header-row scan, duplicate-header dedup, blank
 * separator-row skip, row→object map) lives here.
 *
 * Pure: no I/O, no Next.js types, no exceptions for the success path.
 */

// Vendor pricing exports (DePuy, Stryker, J&J, etc.) frequently put a title
// row / branding row / blank row above the real header row, so a strict
// "row 1 is the header" rule rejects them. Scan the first 15 rows for the
// most plausible header — the row with the most non-empty cells that also
// contains at least one known pricing-token.
const HEADER_TOKENS = [
  "item",
  "sku",
  "part",
  "ref",
  "reference",
  "catalog",
  "product",
  "description",
  "desc",
  "price",
  "cost",
  "uom",
  "unit",
  "category",
  "vendor",
  "manufacturer",
  "list",
  "contract",
  "discount",
  "msrp",
]

const looksLikeHeader = (row: string[]): boolean => {
  const joined = row.join(" ").toLowerCase()
  return HEADER_TOKENS.some((t) => joined.includes(t))
}

const nonEmptyCount = (row: string[]) => row.filter((c) => c).length

export type HeaderDetectionResult = {
  headers: string[]
  rows: Record<string, string>[]
  headerRowIndex: number
}

/**
 * Convert a uniform `string[][]` matrix into `{ headers, rows }`:
 *   1. Scan the first 15 rows for the most plausible header row (most
 *      non-empty cells containing a pricing token; fall back to the first
 *      row with ≥2 non-empty cells; finally row 0).
 *   2. Disambiguate duplicate header names by appending " (2)", " (3)".
 *   3. Build one record per data row, skipping all-blank separator rows.
 *
 * Throws an Error with a user-facing message when the matrix is empty,
 * the chosen header row has no labels, or there are no data rows — the
 * callers translate these into their own surface's error path (HTTP 400
 * in the route, a toast in the client reader).
 */
export function matrixToHeadersAndRows(
  matrix: string[][],
): HeaderDetectionResult {
  if (matrix.length === 0) {
    throw new Error("No data found in first sheet")
  }

  const SCAN_LIMIT = Math.min(matrix.length, 15)
  let headerRowIdx = -1
  let bestScore = 0
  for (let r = 0; r < SCAN_LIMIT; r += 1) {
    const row = matrix[r] ?? []
    if (!looksLikeHeader(row)) continue
    const score = nonEmptyCount(row)
    if (score > bestScore) {
      bestScore = score
      headerRowIdx = r
    }
  }
  if (headerRowIdx === -1) {
    // No token match — accept the first row with ≥2 non-empty cells.
    for (let r = 0; r < SCAN_LIMIT; r += 1) {
      if (nonEmptyCount(matrix[r] ?? []) >= 2) {
        headerRowIdx = r
        break
      }
    }
  }
  if (headerRowIdx === -1) headerRowIdx = 0

  const rawHeaderRow = matrix[headerRowIdx] ?? []
  if (rawHeaderRow.length === 0 || rawHeaderRow.every((h) => h === "")) {
    throw new Error(
      "No headers found in the first 15 rows. Make sure your file has a row with column labels like 'Item No', 'Description', 'Price'.",
    )
  }

  // Vick 2026-05-30: DePuy export ships duplicate header names
  // ("Category"/"CATEGORY", "PRICE BOOK" twice, "PRICING END DATE" twice).
  // When headers collide the row→object map silently overwrites earlier
  // values with the same key. Disambiguate by appending " (2)", " (3)" so
  // each column survives the round trip.
  const seen = new Map<string, number>()
  const headers = rawHeaderRow.map((h) => {
    const trimmed = h.trim()
    if (!trimmed) return trimmed
    const lower = trimmed.toLowerCase()
    const count = (seen.get(lower) ?? 0) + 1
    seen.set(lower, count)
    return count === 1 ? trimmed : `${trimmed} (${count})`
  })

  const rows: Record<string, string>[] = []
  for (let r = headerRowIdx + 1; r < matrix.length; r += 1) {
    const arr = matrix[r] ?? []
    if (arr.every((c) => !c)) continue // skip blank separator rows
    const record: Record<string, string> = {}
    headers.forEach((h, idx) => {
      if (!h) return
      record[h] = arr[idx] ?? ""
    })
    rows.push(record)
  }

  if (rows.length === 0) {
    throw new Error("File contains no data rows")
  }

  return {
    headers: headers.filter((h) => h !== ""),
    rows,
    headerRowIndex: headerRowIdx,
  }
}
