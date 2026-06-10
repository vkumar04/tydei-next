/**
 * Shared pricing-file reader for the prospective-analysis surfaces
 * (Pricing tab + the proposal "add the price file" ask, 2026-06-10).
 * CSV parses client-side; Excel delegates to /api/parse-file.
 */

import type { PricingFileItem } from "@/lib/prospective-analysis/pricing-file-analysis"

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function findIndex(normHeaders: string[], ...aliases: string[]): number {
  return aliases
    .map(norm)
    .reduce<number>(
      (found, alias) => (found >= 0 ? found : normHeaders.indexOf(alias)),
      -1,
    )
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
  if (ext === "csv") {
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
  const idxItem = findIndex(
    normHeaders,
    "item_no",
    "itemno",
    "vendor_item_no",
    "vendoritemno",
    "sku",
    "item_number",
    "itemnumber",
  )
  const idxDesc = findIndex(
    normHeaders,
    "description",
    "desc",
    "item_description",
    "product_name",
  )
  const idxProposed = findIndex(
    normHeaders,
    "proposed_price",
    "proposedprice",
    "price",
    "unit_price",
    "new_price",
  )
  const idxCurrent = findIndex(
    normHeaders,
    "current_price",
    "currentprice",
    "unit_cost",
    "cost",
  )
  const idxQty = findIndex(
    normHeaders,
    "quantity",
    "qty",
    "quantity_ordered",
    "estimated_qty",
    "annual_qty",
  )

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

