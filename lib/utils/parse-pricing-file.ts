/**
 * Client-side pricing file parser.
 *
 * Parses CSV / Excel files into ContractPricingItem[] using the same broad
 * header-alias list that was previously inlined in new-contract-client.tsx.
 * Used by both the AI extract review step and the Upload PDF tab.
 */

import type { ContractPricingItem } from "@/lib/actions/pricing-files"

// ─── Normalise helper ────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

// ─── Header alias resolver ───────────────────────────────────────
function findHeader(normHeaders: string[], rawHeaders: string[], ...aliases: string[]): number {
  return aliases.map(norm).reduce<number>(
    (found, a) => (found >= 0 ? found : normHeaders.indexOf(a)),
    -1,
  )
}

// ─── Auto-detect column mapping from raw headers ─────────────────
export function detectPricingColumnMapping(rawHeaders: string[]): Record<string, string> {
  const normHeaders = rawHeaders.map(norm)

  const idxItem = findHeader(normHeaders, rawHeaders,
    "vendor_item_no", "vendoritemno", "vendoritem",
    "item_no", "itemno", "sku",
    "part_no", "partnumber", "partno", "catalog_no",
    "itemnumber", "item", "itemid", "itemcode",
    "stockno", "stocknumber", "materialid", "materialnumber",
    "productid", "productcode", "vendorpart", "vendorcatalog",
    "catalogno", "catalognumber", "referenceno", "refno", "refnumber",
    "referencenumber", "reference",
    // "Catalog Item" — Stryker joint price/COG files label the SKU column
    // this way; without it the auto-detector misses the SKU → manual mapping
    // or off-catalog. Charles 2026-06-07.
    "catalogitem", "catalogitemno", "catalog",
    // Bug B 2026-05-25 (Charles Bugs.rtfd "Carve out xls price file
    // not working"): the SYK Carve out workbook ships with the header
    // typo "Reference numer" (missing 'b'). Add the typo variant so
    // the auto-detector matches it instead of falling through to the
    // "Could not auto-detect columns" error.
    "referencenumer", "reference_numer",
    "vendor_item_number", "vendoritemnumber", "item_number",
    "productno", "productnumber", "productref", "productrefnumber",
    // Vick 2026-05-30: DePuy real-world export uses "PROD CD"
    // (short for product code). Without "prodcd" the auto-detector
    // misses the SKU column and the whole file fails.
    "prodcd", "prod_cd", "prodno", "prod_no", "prodid", "prod_id",
    "itemcd", "item_cd",
  )
  const idxDesc = findHeader(normHeaders, rawHeaders,
    "description", "desc", "product_description", "productdescription", "item_description",
    "productdesc", "itemname", "materialname", "materialdesc",
    "fulldescription",
    // Vick 2026-05-30: DePuy "PROD DESCRIPTION" normalizes to
    // "proddescription" (no space-strip can save it). ZB "ITEM
    // DESCRIPTION" normalizes to "itemdescription" — already
    // matches via item_description. Add the prod_description
    // family explicitly.
    "prod_description", "proddescription", "prod_desc",
    "itemdescription",
  )
  const idxPrice = findHeader(normHeaders, rawHeaders,
    "contract_price", "contractprice", "unit_price", "unitprice", "price", "cost",
    "netprice", "yourprice", "discountprice", "discountedprice",
    "negotiatedprice", "agreementprice", "contractcost", "netcost",
    "sellprice", "sellingprice", "customerprice",
    // Vick 2026-05-30: DePuy export ships four price columns
    // (DIRECT BX PRICE, INDIRECT BX PRICE, DIRECT DZ PRICE,
    // INDIRECT DZ PRICE). Most rows only populate one of them.
    // Match the BX price first (per-unit) since the import treats
    // each row as a single unit; DZ is dozen-priced and would
    // need a per-row divide. List in priority order so the first
    // present column wins.
    "directbxprice", "direct_bx_price",
    "indirectbxprice", "indirect_bx_price",
    "bxprice", "bx_price",
    "directdzprice", "direct_dz_price",
    "indirectdzprice", "indirect_dz_price",
    "dzprice", "dz_price",
  )
  const idxList = findHeader(normHeaders, rawHeaders,
    "list_price", "listprice", "msrp", "retail_price",
    "catalogprice", "regularprice", "standardprice",
    "fullprice", "originalprice",
  )
  const idxCat = findHeader(normHeaders, rawHeaders,
    "category", "product_category", "department",
    "productcategory", "productcatgory",
    "productline", "productgroup", "producttype",
    "segment", "classification", "dept", "division",
  )
  const idxUom = findHeader(normHeaders, rawHeaders,
    "uom", "unit_of_measure", "unit",
    "unitofmeasure", "packsize", "packaging", "pkg", "measure",
    // Vick 2026-05-30: ZB pricing uses "UM" (not "UOM").
    "um",
  )
  // Bug B 2026-05-25: previously buildPricingItems read a
  // `carveOutPercent` column via the mapping, but detectPricingColumnMapping
  // never populated it — so every row came out with carveOutPercent
  // undefined. The SYK Carve out workbook ships a "Carve out %" column
  // that the loader silently dropped.
  const idxCarve = findHeader(normHeaders, rawHeaders,
    "carve_out_percent", "carveoutpercent", "carve_out_pct", "carveoutpct",
    "carveout", "carve_out", "carveoutpercentage",
    "carveoutrate", "carve_out_rate",
  )

  const autoMap: Record<string, string> = {}
  if (idxItem >= 0) autoMap.vendorItemNo = rawHeaders[idxItem]
  if (idxDesc >= 0) autoMap.description = rawHeaders[idxDesc]
  if (idxPrice >= 0) autoMap.unitPrice = rawHeaders[idxPrice]
  if (idxList >= 0) autoMap.listPrice = rawHeaders[idxList]
  if (idxCat >= 0) autoMap.category = rawHeaders[idxCat]
  if (idxUom >= 0) autoMap.uom = rawHeaders[idxUom]
  if (idxCarve >= 0) autoMap.carveOutPercent = rawHeaders[idxCarve]

  return autoMap
}

/**
 * Decide whether the upload must route through the manual column-mapper.
 *
 * Always true when the REQUIRED columns (vendorItemNo, unitPrice) weren't
 * auto-detected. Also true when no category column was detected BUT the file
 * has at least one column we didn't map to anything — that leftover column is
 * very likely an unrecognized category header (e.g. "Dept", "Prod Line"), and
 * silently importing would drop the category so the realign step never fires
 * ("no category mapping is happening", Charles 2026-06-06). Files whose every
 * column is already mapped (a plain item+price[+list/uom] price list with no
 * category at all) import straight through — no added friction.
 */
export function pricingNeedsManualMapping(
  autoMap: Record<string, string>,
  rawHeaders: string[],
): boolean {
  if (!autoMap.vendorItemNo || !autoMap.unitPrice) return true
  if (autoMap.category) return false
  const mapped = new Set(Object.values(autoMap))
  return rawHeaders.some((h) => h.trim() !== "" && !mapped.has(h))
}

// ─── Build pricing items from raw rows + mapping ─────────────────
export function buildPricingItems(
  dataRows: string[][],
  rawHeaders: string[],
  colMapping: Record<string, string>,
): ContractPricingItem[] {
  const indexOf = (field: string) => {
    const col = colMapping[field]
    return col ? rawHeaders.indexOf(col) : -1
  }

  const idxItem = indexOf("vendorItemNo")
  const idxDesc = indexOf("description")
  const idxPrice = indexOf("unitPrice")
  const idxList = indexOf("listPrice")
  const idxCat = indexOf("category")
  const idxUom = indexOf("uom")
  // Charles iMessage 2026-04-20 N17: carve-out % column. Stored as a
  // fraction on PricingFile.carveOutPercent. Source can provide either
  // "3", "3%", or "0.03" — normalize by dropping non-numerics and
  // dividing by 100 when the value is > 1.
  const idxCarve = indexOf("carveOutPercent")

  return dataRows
    .map((vals) => {
      const g = (idx: number) => (idx >= 0 ? vals[idx] ?? "" : "")
      const rawCarve = g(idxCarve).replace(/[^0-9.-]/g, "")
      let carveOutPercent: number | undefined
      if (rawCarve) {
        const n = parseFloat(rawCarve)
        if (Number.isFinite(n) && n > 0) {
          carveOutPercent = n > 1 ? n / 100 : n
        }
      }
      return {
        vendorItemNo: g(idxItem),
        description: g(idxDesc) || undefined,
        unitPrice: parseFloat(g(idxPrice).replace(/[^0-9.-]/g, "") || "0"),
        listPrice:
          parseFloat(g(idxList).replace(/[^0-9.-]/g, "") || "0") || undefined,
        category: g(idxCat) || undefined,
        uom: g(idxUom) || "EA",
        carveOutPercent,
      }
    })
    .filter((i) => i.vendorItemNo)
}

// ─── CSV row parser that respects quoted fields ────────────────
function parseCSVRow(line: string): string[] {
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

// ─── Parse a raw file (CSV or Excel via /api/parse-file) ─────────
export interface ParsedPricingFile {
  items: ContractPricingItem[]
  categories: string[]
  rawHeaders: string[]
  rawRows: Record<string, string>[]
  autoMapping: Record<string, string>
  /** true when auto-mapping is incomplete (missing vendorItemNo or unitPrice) */
  needsManualMapping: boolean
}

export async function parsePricingFile(file: File): Promise<ParsedPricingFile> {
  const ext = file.name.split(".").pop()?.toLowerCase()
  if (!["csv", "xlsx", "xls"].includes(ext ?? "")) {
    throw new Error("Please upload a CSV or Excel (.xlsx/.xls) pricing file")
  }

  let rawHeaders: string[] = []
  let dataRows: string[][] = []

  if (ext === "xlsx" || ext === "xls") {
    const formData = new FormData()
    formData.append("file", file)
    const res = await fetch("/api/parse-file", {
      method: "POST",
      body: formData,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error((body as { error?: string } | null)?.error ?? "Failed to parse Excel file")
    }
    const parsed = (await res.json()) as { headers: string[]; rows: Record<string, string>[] }
    rawHeaders = parsed.headers
    dataRows = parsed.rows.map((row) => rawHeaders.map((h) => row[h] ?? ""))
  } else {
    let text = await file.text()
    // Strip BOM character if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1)
    }
    // Normalise line endings and filter empty rows
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim())
    rawHeaders = parseCSVRow(lines[0] ?? "").map((h) => h.replace(/^"|"$/g, ""))
    dataRows = lines.slice(1).map((line) => parseCSVRow(line))
  }

  const autoMap = detectPricingColumnMapping(rawHeaders)
  const needsManualMapping = pricingNeedsManualMapping(autoMap, rawHeaders)

  const recordRows = dataRows.map((vals) => {
    const row: Record<string, string> = {}
    rawHeaders.forEach((h, i) => { row[h] = vals[i] ?? "" })
    return row
  })

  const items = needsManualMapping ? [] : buildPricingItems(dataRows, rawHeaders, autoMap)
  const categories = Array.from(
    new Set(items.map((i) => i.category).filter((c): c is string => !!c))
  )

  return { items, categories, rawHeaders, rawRows: recordRows, autoMapping: autoMap, needsManualMapping }
}
