/**
 * Column mapping utility — AI-first with local fallback.
 *
 * 1. Tries Gemini via /api/ai/map-columns
 * 2. If that fails (offline, rate-limited, error), falls back to
 *    normalised string matching with common aliases.
 */

interface TargetField {
  key: string
  label: string
  required: boolean
}

// ─── Local fallback aliases ──────────────────────────────────────
const ALIASES: Record<string, string[]> = {
  // Pricing fields
  vendorItemNo: [
    "vendoritemno", "vendoritemnumber", "vendoritem", "supplieritemno",
    "supplieritemnumber", "itemno", "itemnumber", "itemid", "sku",
    "partno", "partnumber", "productno", "productnumber", "catalogno",
    "catalognumber", "vendorpartno", "vendorpartnumber", "supplierpart",
  ],
  productDescription: [
    "productdescription", "description", "desc", "itemdescription",
    "itemdesc", "productname", "product", "item", "name", "materialdesc",
  ],
  manufacturerNo: [
    "manufacturerno", "manufacturernumber", "mfgno", "mfgnumber",
    "manufacturer", "mfg", "mfrid", "mfrno", "manufacturerpartno",
    "manufacturerpartnumber", "mfrcatalogno", "mfgcatalogno",
  ],
  listPrice: [
    "listprice", "list", "msrp", "retailprice", "retail",
    "suggestedprice", "baseprice",
  ],
  contractPrice: [
    "contractprice", "contract", "negotiatedprice", "negotiatedunitprice",
    "netprice", "price", "unitprice", "cost", "unitcost", "saleprice",
  ],
  effectiveDate: [
    "effectivedate", "effective", "startdate", "start", "begindate",
    "validfrom", "datefrom", "contractstart",
  ],
  expirationDate: [
    "expirationdate", "expiration", "enddate", "end", "expdate",
    "validto", "dateto", "expirydate", "expiry", "validuntil",
    "contractend",
  ],
  category: [
    "category", "cat", "productcategory", "itemcategory",
    "department", "dept", "group", "productgroup", "productline",
    "segment",
  ],
  uom: [
    "uom", "unitofmeasure", "unit", "measure", "um", "uofm",
    "packsize", "packaging", "pkg",
  ],
  // COG fields
  inventoryNumber: [
    "inventorynumber", "inventoryno", "invno", "invnumber",
    "itemno", "itemnumber", "sku",
    "productrefnumber", "productref", "refnumber", "refno",
    "productnumber", "productno",
  ],
  inventoryDescription: [
    "inventorydescription", "description", "desc",
    "itemdescription", "itemdesc", "productdescription",
    "productname", "productdesc",
  ],
  vendorName: [
    "vendorname", "vendor", "suppliername", "supplier",
  ],
  unitCost: [
    "unitcost", "unitprice", "cost", "price", "eachprice",
  ],
  extendedPrice: [
    "extendedprice", "extprice", "extendedcost", "totalcost",
    "totalprice", "lineamount", "linetotal", "amount",
  ],
  quantity: [
    "quantity", "qty", "units", "count",
    "quantityordered", "qtyordered", "orderedquantity",
  ],
  transactionDate: [
    "transactiondate", "date", "invoicedate", "orderdate",
    "txndate", "purchasedate",
    "dateordered", "ordereddate",
  ],
  // Carve-out field
  carveOut: [
    "carveout", "carve_out", "excluded", "exempt", "carved_out",
    "exclusion", "is_excluded", "carve",
  ],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

export function localMapColumns(
  headers: string[],
  targetFields: TargetField[]
): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of targetFields) {
    // Exact normalised key match
    let match = headers.find((h) => norm(h) === norm(field.key))
    // Alias match
    if (!match) {
      const aliases = ALIASES[field.key] ?? []
      match = headers.find((h) => aliases.includes(norm(h)))
    }
    // Label match (e.g. "Unit Cost" matches field.label "Unit Cost")
    if (!match) {
      match = headers.find((h) => norm(h) === norm(field.label))
    }
    if (match) mapping[field.key] = match
  }
  return mapping
}

// ─── AI mapping ──────────────────────────────────────────────────
async function aiMapColumns(
  headers: string[],
  targetFields: TargetField[],
  sampleRows: Record<string, string>[]
): Promise<Record<string, string>> {
  const res = await fetch("/api/ai/map-columns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceHeaders: headers,
      targetFields: targetFields.map((f) => ({
        key: f.key,
        label: f.label,
        required: f.required,
      })),
      sampleRows: sampleRows.slice(0, 3),
    }),
  })
  if (!res.ok) throw new Error(`AI mapping failed: ${res.status}`)
  const data = await res.json()
  return data.mapping ?? {}
}

// ─── Public API ──────────────────────────────────────────────────
export async function mapColumns(
  headers: string[],
  targetFields: TargetField[],
  sampleRows: Record<string, string>[]
): Promise<Record<string, string>> {
  try {
    const mapping = await aiMapColumns(headers, targetFields, sampleRows)
    // If AI returned at least the required fields, use it
    const requiredKeys = targetFields.filter((f) => f.required).map((f) => f.key)
    const hasRequired = requiredKeys.every((k) => mapping[k])
    if (hasRequired) return mapping
    // AI didn't map all required fields — merge with local fallback
    const fallback = localMapColumns(headers, targetFields)
    return { ...fallback, ...mapping }
  } catch {
    // AI unavailable — use local fallback entirely
    return localMapColumns(headers, targetFields)
  }
}
