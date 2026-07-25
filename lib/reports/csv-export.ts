/**
 * Reports hub — CSV export helpers.
 *
 * Pure serialization: takes typed rows + columns, returns a CSV-safe
 * string. No file I/O; the caller writes/downloads the result.
 *
 * Quoting rule: every cell is double-quoted so commas, quotes, and
 * newlines inside cell values don't break the format. Embedded quotes
 * are escaped by doubling (`"` → `""`), per RFC 4180.
 */

export interface CSVExportInput<TRow extends Record<string, unknown>> {
  columns: Array<{
    /** Object key on each row — the source of the cell value. */
    key: keyof TRow & string
    /** Human-readable header rendered in the first CSV line. */
    label: string
    /** Optional formatter — turn the raw value into a string. Defaults to String(value). */
    format?: (value: TRow[keyof TRow & string], row: TRow) => string
  }>
  rows: TRow[]
}

function escapeCell(value: string): string {
  // CSV formula-injection defense: spreadsheet apps (Excel/Sheets) execute
  // a cell whose text starts with = + - @ (or a leading tab/CR). Exported
  // values include user/vendor-supplied free text (item descriptions,
  // vendor names, notes imported from uploaded files), so neutralize those
  // by prefixing a single quote, which Excel treats as "literal text".
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  // Wrap every cell in double quotes and double-escape internal quotes.
  return `"${neutralized.replace(/"/g, '""')}"`
}

/** Default formatter — handles common primitive types; falls through to String(). */
function defaultFormat(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "number") {
    // Preserve exact representation — no thousand separator, no currency symbol.
    return Number.isFinite(value) ? String(value) : ""
  }
  if (typeof value === "boolean") return value ? "true" : "false"
  return String(value)
}

/**
 * Serialize `rows` to a CSV string using the given column metadata.
 * Output terminator: `\n` between rows. No trailing newline.
 */
export function toCSV<TRow extends Record<string, unknown>>(
  input: CSVExportInput<TRow>,
): string {
  const headerLine = input.columns.map((c) => escapeCell(c.label)).join(",")

  const dataLines = input.rows.map((row) =>
    input.columns
      .map((col) => {
        const raw = row[col.key]
        const formatted = col.format
          ? col.format(raw as TRow[keyof TRow & string], row)
          : defaultFormat(raw)
        return escapeCell(formatted)
      })
      .join(","),
  )

  return [headerLine, ...dataLines].join("\n")
}

/**
 * Build the canonical filename for a report export. Matches the
 * AI-agent spec §4.3 / canonical facility-reports doc §9 style.
 *
 *   `${title.replace(/\s+/g, '_')}_${YYYY-MM-DD}.csv`
 *
 * Strips filesystem-hostile chars (`/\:*?"<>|`) for cross-platform safety.
 */
export function buildReportFilename(title: string, date: Date = new Date()): string {
  const safe = title
    .replace(/\s+/g, "_")
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/^_+|_+$/g, "")
    || "report"
  const iso = date.toISOString().slice(0, 10)
  return `${safe}_${iso}.csv`
}
