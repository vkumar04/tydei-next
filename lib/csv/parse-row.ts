/**
 * Canonical RFC-4180 single-row CSV parser. Splits one line into fields,
 * honoring double-quoted fields and the doubled-quote ("") escape, and
 * trims each field. Shared by every CSV-reading surface (the contract
 * pricing-file parser and the shared tabular-file reader) so they cannot
 * drift apart.
 */
export function parseCsvRow(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") inside a quoted field
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip the second quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        fields.push(current.trim())
        current = ""
      } else {
        current += ch
      }
    }
  }
  fields.push(current.trim())
  return fields
}
