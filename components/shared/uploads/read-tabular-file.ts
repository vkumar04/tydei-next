/**
 * Canonical tabular-file reader for every upload surface (moved here
 * from components/facility/analysis/prospective/pricing-file-reader.ts
 * as part of the shared <PricingFileDropzone>, uploader improvements
 * 1+2, 2026-06-13 — the old path re-exports it so existing imports keep
 * working).
 *
 * CSV/TXT parse client-side (BOM strip, CRLF normalization, quoted
 * fields). XLSX/XLS ALSO parse client-side now (perf, 2026-06-13): the
 * old /api/parse-file round-trip dominated upload latency (~700ms warm,
 * multiple seconds on a cold serverless start) even though the parser
 * itself is ~115ms. SheetJS (`xlsx`, already a dependency) reads both
 * modern .xlsx and legacy .xls; it's DYNAMICALLY imported so the ~900KB
 * library lands in a lazy chunk that only loads on the first Excel drop,
 * not the initial page bundle. The header-row scan + dedup + blank-row
 * skip is shared VERBATIM with /api/parse-file via
 * lib/utils/tabular/detect-headers.ts, so a file that parsed via the
 * route before yields identical { headers, rows } here — the only
 * variable is the matrix extraction (SheetJS raw:false display strings,
 * which already coerce rich-text/formula/hyperlink cells to their shown
 * value, so the route's ExcelJS object-coercion isn't needed here).
 */

import { matrixToHeadersAndRows } from "@/lib/utils/tabular/detect-headers"
import { parseCsvRow } from "@/lib/csv/parse-row"

// Mirror of the route's 100MB cap (Bug #27, 2026-05-11): real-facility
// COG dumps run 50-200MB on quarterly exports.
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

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
  // Excel (.xlsx / legacy .xls) — parse CLIENT-SIDE with SheetJS. Same
  // 100MB cap + message the route surfaces (Bug #27).
  if (file.size > MAX_FILE_SIZE) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    throw new Error(
      `File is ${mb}MB; max is 100MB. Split the workbook into multiple sheets/files, or export each tab as a separate .csv.`,
    )
  }

  // Dynamic import keeps the ~900KB SheetJS library out of the initial
  // page bundle — it loads as a lazy chunk on the first Excel drop, then
  // the browser caches it.
  const XLSX = await import("xlsx")
  const arrayBuffer = await file.arrayBuffer()

  let workbook: import("xlsx").WorkBook
  try {
    workbook = XLSX.read(arrayBuffer, { type: "array" })
  } catch (err) {
    // SheetJS throws "Can't find end of central directory" when the file
    // isn't a valid workbook — most commonly a renamed CSV. Classify it
    // the same way the route did so the user knows how to self-correct.
    const message = err instanceof Error ? err.message : ""
    if (message.includes("end of central directory")) {
      throw new Error(
        "This file doesn't look like a valid .xlsx workbook. If it's a CSV, rename the extension to .csv and re-upload.",
      )
    }
    throw new Error("Failed to parse Excel file")
  }

  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error("No sheets found in file")
  const sheet = workbook.Sheets[firstSheetName]
  if (!sheet) throw new Error("First sheet is empty")

  // header:1 → array-of-arrays; defval:"" → blank cells stay positional;
  // raw:false → formatted display strings (rich-text / formula /
  // hyperlink cells come out as their shown value, so no object-coercion
  // is needed on this path). Coerce + trim each cell to a plain string.
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  })
  const matrix: string[][] = raw.map((row) =>
    (row ?? []).map((v) => String(v ?? "").trim()),
  )

  // Shared header-row scan + dedup + blank-row skip (identical to the
  // route). Throws on empty-matrix / no-headers / no-data-rows with the
  // same user-facing messages.
  const { headers, rows } = matrixToHeadersAndRows(matrix)
  return { headers, rows }
}
