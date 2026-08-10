/**
 * Memory-bounded CSV → row-record parser for upload route handlers.
 *
 * The sibling `parseXlsxMatrixBounded` (lib/xlsx/parse-xlsx-bounded.ts) caps
 * the spreadsheet path; the CSV path had no equivalent. Every import route
 * hand-rolled the same splitter and materialized one `Record<string, string>`
 * per line with one key per HEADER column — neither dimension bounded — while
 * the ingestion action's own row cap ran only AFTER the whole array existed.
 *
 * The caps here are measured, not nominal: a bound that runs after the
 * allocation it bounds is not a bound. `text.split(/\r?\n/)` on a 100MB body,
 * or splitting a 10M-field header before checking the column cap, allocates
 * gigabytes before any check fires — that is the exact DoS this module exists
 * to stop. So the guard pass walks the string by INDEX (no array, no
 * substring) and only the surviving, in-bounds input is materialized.
 *
 * Shared by /api/import-cog, /api/import-pricing, /api/import-payor-volume.
 */

export class CsvLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CsvLimitError"
  }
}

export interface ParseCsvBoundedOptions {
  /** Reject beyond this many DATA rows (excludes the header). */
  maxRows?: number
  /** Reject beyond this many fields, on the header AND on every data row. */
  maxColumns?: number
}

/** Generous enough for the real 46k-row COG imports, far below OOM. */
const DEFAULT_MAX_ROWS = 200_000
/** Real tabular exports top out around 30 columns; 256 is Excel-era slack. */
const DEFAULT_MAX_COLUMNS = 256

/** True when `text[start, end)` holds nothing but whitespace. */
function isBlankSlice(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i)
    // space, tab, CR, LF, FF, VT — matches the `\s`-trim the parser applies.
    if (c !== 32 && (c < 9 || c > 13)) return false
  }
  return true
}

/**
 * Count the fields in `text[start, end)` without allocating anything.
 * Quote-aware so a quoted comma is not counted as a separator.
 */
function countFields(text: string, start: number, end: number): number {
  let fields = 1
  let inQuotes = false
  for (let i = start; i < end; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++
      else inQuotes = !inQuotes
    } else if (ch === "," && !inQuotes) {
      fields++
    }
  }
  return fields
}

/** Split one CSV line, honoring quoted fields and "" escapes. */
function splitRow(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/** Half-open [start, end) bounds of one non-blank line, CR excluded. */
interface LineSpan {
  start: number
  end: number
}

/**
 * Walk the text by index, collecting the spans of non-blank lines and
 * enforcing both caps as it goes. Allocates one small {start,end} per
 * surviving line and nothing per field — so an over-cap input is rejected
 * having allocated O(lines seen), never O(file).
 */
function scanLines(
  text: string,
  maxRows: number,
  maxColumns: number,
): LineSpan[] {
  const spans: LineSpan[] = []
  let pos = 0
  const len = text.length

  while (pos <= len) {
    let nl = text.indexOf("\n", pos)
    if (nl === -1) nl = len
    let end = nl
    if (end > pos && text.charCodeAt(end - 1) === 13) end-- // trailing CR

    if (!isBlankSlice(text, pos, end)) {
      // spans[0] is the header; every later span is a data row.
      if (spans.length > maxRows) {
        throw new CsvLimitError(
          `CSV has more than ${maxRows.toLocaleString()} rows; max is ${maxRows.toLocaleString()}. Split it into smaller files.`,
        )
      }
      const fields = countFields(text, pos, end)
      if (fields > maxColumns) {
        const where = spans.length === 0 ? "header" : `row ${spans.length}`
        throw new CsvLimitError(
          `CSV ${where} has ${fields.toLocaleString()} fields; max is ${maxColumns.toLocaleString()}. This does not look like a tabular export.`,
        )
      }
      spans.push({ start: pos, end })
    }

    if (nl === len) break
    pos = nl + 1
  }
  return spans
}

/**
 * Parse CSV text into header-keyed row records, rejecting oversized input
 * before allocating the rows.
 *
 * @throws {CsvLimitError} when the row or column cap is exceeded.
 */
export function parseCsvTextBounded(
  text: string,
  options: ParseCsvBoundedOptions = {},
): { headers: string[]; rows: Record<string, string>[] } {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS

  // Strip a leading BOM by offsetting rather than rewriting the whole string.
  const offset = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const body = offset === 0 ? text : text.slice(offset)

  const spans = scanLines(body, maxRows, maxColumns)
  if (spans.length === 0) return { headers: [], rows: [] }

  const headers = splitRow(body.slice(spans[0].start, spans[0].end))
  const rows: Record<string, string>[] = []
  for (let i = 1; i < spans.length; i++) {
    const cells = splitRow(body.slice(spans[i].start, spans[i].end))
    // Null prototype: a header literally named "__proto__" must become an own
    // key, never a prototype mutation, and must not inherit Object members
    // that downstream `row[col]` lookups could mistake for real cells.
    const row: Record<string, string> = Object.create(null)
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? ""
    }
    rows.push(row)
  }
  return { headers, rows }
}
