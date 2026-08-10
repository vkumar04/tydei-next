/**
 * Parse an uploaded CMS ASC rate table into `MedicareAscRate[]`.
 *
 * Charles 2026-08-10: "need a place to upload ... the Medicare rates". The
 * built-in table in `medicare-asc-rates.ts` is a CY2025 national-average
 * snapshot; rates are republished annually and vary by geographic locality,
 * so a rep working a specific market needs to supply their own.
 *
 * Unlike the proforma (a label/value sheet), a rate table IS a real
 * header-per-column table, so this consumes header-keyed records the same way
 * the payor-volume parser does.
 */

import { parseMoney } from "@/lib/actions/imports/shared"
import type { MedicareAscRate } from "./medicare-asc-rates"

function pick(
  row: Record<string, string>,
  candidates: string[],
  /** Headers whose presence disqualifies a fuzzy match (ratio columns). */
  excludeSubstrings: string[] = [],
): string | undefined {
  const keys = Object.keys(row)
  const allowed = (k: string) => {
    const lower = k.trim().toLowerCase()
    return !excludeSubstrings.some((x) => lower.includes(x))
  }
  for (const cand of candidates) {
    const hit = keys.find((k) => k.trim().toLowerCase() === cand)
    if (hit !== undefined) return row[hit]
  }
  for (const cand of candidates) {
    const hit = keys.find(
      (k) => allowed(k) && k.trim().toLowerCase().includes(cand),
    )
    if (hit !== undefined) return row[hit]
  }
  return undefined
}

/** Ratio/derived columns that must never be read as the dollar rate. */
const RATE_EXCLUDE = ["%", "percent", "pct", "ratio", "change", "delta", "vs "]

export interface ParsedMedicareRates {
  rates: MedicareAscRate[]
  /** Rows skipped for a missing group or an unparseable rate. */
  skipped: number
}

const MAX_RATE = 1_000_000

/**
 * Parse rate rows. Expected columns: Procedure Group, CPT/HCPCS code, Rate.
 * A missing code is tolerated (the group name is the join key against payor
 * volume); a missing or negative rate skips the row.
 */
export function parseMedicareRateRows(
  rows: Record<string, string>[],
): ParsedMedicareRates {
  const byGroup = new Map<string, MedicareAscRate>()
  let skipped = 0

  for (const row of rows) {
    const group = String(
      pick(row, ["procedure group", "group", "procedure", "category", "description"]) ??
        "",
    ).trim()
    if (!group) {
      skipped++
      continue
    }

    const rawRate = pick(
      row,
      [
        "medicare rate",
        "asc rate",
        "payment rate",
        "allowable",
        "rate",
        "amount",
        "payment",
      ],
      RATE_EXCLUDE,
    )
    if (rawRate === undefined || rawRate.trim() === "") {
      skipped++
      continue
    }
    const trimmed = rawRate.trim()
    // A cell with no digits ("N/A", "—", "see note") is MISSING, not $0.
    // parseMoney coerces it to 0, which would install a fabricated $0 rate
    // that then shadows the correct built-in rate for that group.
    if (!/\d/.test(trimmed)) {
      skipped++
      continue
    }
    // A percent cell is a ratio column, not the dollar rate.
    if (trimmed.includes("%")) {
      skipped++
      continue
    }
    const medicareRate = parseMoney(trimmed)
    if (!Number.isFinite(medicareRate) || medicareRate < 0 || medicareRate > MAX_RATE) {
      skipped++
      continue
    }

    const code = String(
      pick(row, ["cpt", "hcpcs", "code", "cpt code", "hcpcs code"]) ?? "",
    ).trim()
    const note = String(pick(row, ["note", "notes", "comment"]) ?? "").trim()

    // Last row wins on a duplicate group — a corrected line later in the
    // file should supersede the earlier one.
    byGroup.set(group.toLowerCase(), {
      group,
      code: code || "—",
      medicareRate,
      ...(note ? { note } : {}),
    })
  }

  return { rates: [...byGroup.values()], skipped }
}
