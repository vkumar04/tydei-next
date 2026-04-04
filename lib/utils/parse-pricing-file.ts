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
    "vendor_item_number", "vendoritemnumber", "item_number",
    "productno", "productnumber", "productref", "productrefnumber",
  )
  const idxDesc = findHeader(normHeaders, rawHeaders,
    "description", "desc", "product_description", "productdescription", "item_description",
    "productdesc", "itemname", "materialname", "materialdesc",
    "fulldescription",
  )
  const idxPrice = findHeader(normHeaders, rawHeaders,
    "contract_price", "contractprice", "unit_price", "unitprice", "price", "cost",
    "netprice", "yourprice", "discountprice", "discountedprice",
    "negotiatedprice", "agreementprice", "contractcost", "netcost",
    "sellprice", "sellingprice", "customerprice",
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
  )

  const autoMap: Record<string, string> = {}
  if (idxItem >= 0) autoMap.vendorItemNo = rawHeaders[idxItem]
  if (idxDesc >= 0) autoMap.description = rawHeaders[idxDesc]
  if (idxPrice >= 0) autoMap.unitPrice = rawHeaders[idxPrice]
  if (idxList >= 0) autoMap.listPrice = rawHeaders[idxList]
  if (idxCat >= 0) autoMap.category = rawHeaders[idxCat]
  if (idxUom >= 0) autoMap.uom = rawHeaders[idxUom]

  return autoMap
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

  return dataRows
    .map((vals) => {
      const g = (idx: number) => (idx >= 0 ? vals[idx] ?? "" : "")
      return {
        vendorItemNo: g(idxItem),
        description: g(idxDesc) || undefined,
        unitPrice: parseFloat(g(idxPrice).replace(/[^0-9.-]/g, "") || "0"),
        listPrice:
          parseFloat(g(idxList).replace(/[^0-9.-]/g, "") || "0") || undefined,
        category: g(idxCat) || undefined,
        uom: g(idxUom) || "EA",
      }
    })
    .filter((i) => i.vendorItemNo)
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
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    rawHeaders = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, "")) ?? []
    dataRows = lines.slice(1).map((line) =>
      line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""))
    )
  }

  const autoMap = detectPricingColumnMapping(rawHeaders)
  const needsManualMapping = !autoMap.vendorItemNo || !autoMap.unitPrice

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
