/**
 * Canonical tabular-file reader for every upload surface (moved here
 * from components/facility/analysis/prospective/pricing-file-reader.ts
 * as part of the shared <PricingFileDropzone>, uploader improvements
 * 1+2, 2026-06-13 — the old path re-exports it so existing imports keep
 * working).
 *
 * CSV/TXT parse client-side (BOM strip, CRLF normalization, quoted
 * fields); XLSX/XLS delegate to /api/parse-file, which also scans for
 * the real header row and dedupes headers.
 */

function parseCsvRow(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
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

export async function readPricingRows(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  // .txt parses as CSV: the vendor proposal-builder uploads accept
  // comma-separated .txt exports (bugs 2026-06-13); routing them to
  // /api/parse-file would fail since they aren't Excel workbooks.
  if (ext === "csv" || ext === "txt") {
    let text = await file.text()
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l) => l.trim())
    const headers = parseCsvRow(lines[0] ?? "").map((h) =>
      h.replace(/^"|"$/g, ""),
    )
    const rows = lines.slice(1).map((line) => {
      const vals = parseCsvRow(line)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => {
        row[h] = vals[i] ?? ""
      })
      return row
    })
    return { headers, rows }
  }
  // Excel — delegate to server
  const formData = new FormData()
  formData.append("file", file)
  const res = await fetch("/api/parse-file", {
    method: "POST",
    body: formData,
  })
  if (!res.ok) throw new Error("Failed to parse Excel file")
  return (await res.json()) as {
    headers: string[]
    rows: Record<string, string>[]
  }
}
