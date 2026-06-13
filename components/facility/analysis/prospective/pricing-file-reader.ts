/**
 * Shared pricing-file reader for the prospective-analysis surfaces
 * (Pricing tab + the proposal "add the price file" ask, 2026-06-10).
 * CSV parses client-side; Excel delegates to /api/parse-file.
 */

import type { PricingFileItem } from "@/lib/prospective-analysis/pricing-file-analysis"
import {
  ITEM_NUMBER_ALIASES,
  DESCRIPTION_ALIASES,
  UNIT_PRICE_ALIASES,
} from "@/lib/utils/parse-pricing-file"

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

// `exclude` lets the proposed-price lookup skip the column already
// claimed as current price (the canonical price aliases include "cost",
// which on a proposal file means what the facility pays TODAY).
function findIndex(
  normHeaders: string[],
  aliases: string[],
  exclude = -1,
): number {
  for (const alias of aliases) {
    const a = norm(alias)
    const idx = normHeaders.findIndex((h, i) => h === a && i !== exclude)
    if (idx >= 0) return idx
  }
  return -1
}

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

export function pricingRowsToItems(
  headers: string[],
  rows: Record<string, string>[],
): PricingFileItem[] {
  const normHeaders = headers.map(norm)
  // Canonical alias lists from lib/utils/parse-pricing-file.ts — do NOT
  // inline a local list here. Bug 2026-06-10 ("Analysis for price not
  // working"): a hand-rolled 7-alias copy missed "ReferenceNumber"
  // (the Arthrex demo file's SKU header) and every row was dropped.
  const idxItem = findIndex(normHeaders, ITEM_NUMBER_ALIASES)
  const idxDesc = findIndex(normHeaders, [
    ...DESCRIPTION_ALIASES,
    "product_name",
  ])
  // Current price resolves FIRST so its aliases ("cost", "unit_cost")
  // can't be claimed by the broader canonical price list below.
  const idxCurrent = findIndex(normHeaders, [
    "current_price",
    "currentprice",
    "unit_cost",
    "cost",
  ])
  const idxProposed = findIndex(
    normHeaders,
    [
      "proposed_price",
      "proposedprice",
      "new_price",
      "newprice",
      "quoted_price",
      "quotedprice",
      ...UNIT_PRICE_ALIASES,
    ],
    idxCurrent,
  )
  const idxQty = findIndex(normHeaders, [
    "quantity",
    "qty",
    "quantity_ordered",
    "estimated_qty",
    "annual_qty",
  ])

  const parseNum = (v: string): number =>
    parseFloat(v.replace(/[^0-9.-]/g, "") || "0")

  return rows
    .map((row): PricingFileItem | null => {
      const get = (idx: number) => (idx >= 0 ? (row[headers[idx]!] ?? "") : "")
      const itemNumber = get(idxItem)
      if (!itemNumber) return null
      const description = get(idxDesc)
      const proposedPrice = parseNum(get(idxProposed))
      const currentRaw = get(idxCurrent)
      const qtyRaw = get(idxQty)
      return {
        itemNumber,
        description,
        proposedPrice,
        currentPrice: currentRaw ? parseNum(currentRaw) || null : null,
        estimatedAnnualQty: qtyRaw ? parseNum(qtyRaw) || null : null,
      }
    })
    .filter((x): x is PricingFileItem => x !== null)
}

