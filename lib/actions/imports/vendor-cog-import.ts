"use server"

/**
 * Vendor-owned COG ingest (1-way mode).
 *
 * The vendor enters its OWN cost-of-goods here. Rows land in
 * `VendorCogRecord` — VENDOR-owned, division-scoped, and NEVER merged into
 * the facility-scoped `COGRecord` reads (keeps the facility-COGRecord
 * invariant intact, see `lib/contracts/vendor-cog-scope.ts`).
 *
 * Structurally mirrors the FACILITY importer
 * (`lib/actions/imports/cog-csv-import.ts`) but differs in three ways:
 *   1. The caller IS the vendor — `requireVendor()` resolves the owning
 *      vendorId; there is NO vendor find-or-create / facility resolution.
 *   2. Rows are stamped with the active `vendorDivisionId` (from `opts`,
 *      nullable = vendor-wide) for hard division isolation.
 *   3. NO `FileImport` row is written — `FileImport` requires a facilityId,
 *      and this is a vendor-side import (the schema's `fileImportId` is a
 *      loose tag with no FK).
 *
 * Column detection routes through the canonical header-alias lists in
 * `lib/utils/parse-pricing-file.ts` via the shared `<PricingFileDropzone>`
 * field-spec resolver — NEVER inline a copy (invariants table: "Pricing-file
 * header detection"). The client passes the user-confirmed `mapping`
 * (field key → raw header) from the dropzone dialog; absent that, we
 * auto-resolve here so non-dropzone callers still work.
 */

import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/audit"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { parseMoney, parseDate } from "./shared"
import {
  ITEM_NUMBER_ALIASES,
  DESCRIPTION_ALIASES,
  UNIT_PRICE_ALIASES,
  CATEGORY_ALIASES,
} from "@/lib/utils/parse-pricing-file"
import {
  resolveMapping,
  overrideIndex,
  type ResolvedMapping,
  type UploadFieldSpec,
} from "@/components/shared/uploads/field-spec"

/**
 * Field specs for the vendor-COG upload, built from the canonical alias
 * lists plus vendor-COG-only extras (PO number, vendor item / manufacturer
 * number, quantity, transaction date). Module-private (a `"use server"`
 * file may only EXPORT async functions): this is the server-side fallback
 * resolver for callers that don't pass the dropzone's confirmed mapping.
 */
const VENDOR_COG_SPECS: UploadFieldSpec[] = [
  {
    key: "inventoryNumber",
    label: "Item / SKU number",
    aliases: ITEM_NUMBER_ALIASES,
    required: true,
    kind: "text",
  },
  {
    key: "description",
    label: "Description",
    aliases: DESCRIPTION_ALIASES,
    kind: "text",
  },
  {
    key: "vendorItemNo",
    label: "Vendor item number",
    aliases: ["vendor_item_no", "vendoritemno", "vendoritem", ...ITEM_NUMBER_ALIASES],
    kind: "text",
  },
  {
    key: "manufacturerNo",
    label: "Manufacturer number",
    aliases: [
      "manufacturer_no",
      "manufacturerno",
      "mfg_no",
      "mfgno",
      "mfr_no",
      "mfrno",
      "manufacturernumber",
      "mfg_number",
    ],
    kind: "text",
  },
  {
    key: "unitCost",
    label: "Unit cost",
    aliases: UNIT_PRICE_ALIASES,
    required: true,
    kind: "number",
  },
  {
    key: "extendedPrice",
    label: "Extended cost",
    aliases: [
      "extended_price",
      "extendedprice",
      "extended_cost",
      "extendedcost",
      "extended",
      "ext_cost",
      "extcost",
      "line_total",
      "linetotal",
      "total_cost",
      "totalcost",
    ],
    kind: "number",
  },
  {
    key: "quantity",
    label: "Quantity",
    aliases: ["quantity", "qty", "units", "unitsordered", "qtyordered", "orderqty"],
    kind: "number",
  },
  {
    key: "poNumber",
    label: "Purchase order number",
    aliases: ["po_number", "ponumber", "po_no", "pono", "po", "purchaseorder", "purchaseordernumber"],
    kind: "text",
  },
  {
    key: "category",
    label: "Category",
    aliases: CATEGORY_ALIASES,
    kind: "text",
  },
  {
    key: "transactionDate",
    label: "Transaction date",
    aliases: [
      "transaction_date",
      "transactiondate",
      "date",
      "dateordered",
      "orderdate",
      "order_date",
      "invoicedate",
      "invoice_date",
      "shipdate",
      "ship_date",
    ],
    required: true,
    kind: "date",
  },
]

export interface BulkImportVendorCogOptions {
  /**
   * The user-confirmed column mapping (field key → raw header) from the
   * shared `<PricingFileDropzone>` dialog. When provided it FULLY replaces
   * auto-detection; absent, the server resolves columns from the canonical
   * alias specs above.
   */
  mapping?: ResolvedMapping
  /**
   * Active division to stamp every imported row with (hard isolation).
   * `null`/`undefined` = vendor-wide (no division). The caller picks this
   * from the division switcher; the action does NOT infer it.
   */
  vendorDivisionId?: string | null
  fileName?: string
}

export interface VendorCogImportResult {
  imported: number
  skipped: number
}

/**
 * Bulk-insert vendor-owned COG rows from parsed file rows.
 */
export async function bulkImportVendorCogRecords(
  rows: Record<string, string>[],
  opts: BulkImportVendorCogOptions = {},
): Promise<VendorCogImportResult> {
  await requireCanMutate()
  const session = await requireVendor()
  const vendorId = session.vendor.id

  if (rows.length === 0) return { imported: 0, skipped: 0 }

  const headers = Object.keys(rows[0] ?? {})
  // The client's confirmed mapping wins; otherwise auto-resolve from the
  // canonical alias specs. Either way column lookup goes through the shared
  // field-spec resolver — never a hand-rolled alias list.
  const mapping: ResolvedMapping =
    opts.mapping ?? resolveMapping(headers, VENDOR_COG_SPECS).mapping

  const idx = (key: string): number => {
    if (opts.mapping) return overrideIndex(headers, mapping, key)
    const mapped = mapping[key]
    return mapped ? headers.indexOf(mapped) : -1
  }
  // Column → header value getter (works for both the override + auto path).
  const cell = (row: Record<string, string>, key: string): string => {
    const i = idx(key)
    if (i < 0) return ""
    return (row[headers[i] ?? ""] ?? "").trim()
  }

  const divisionId = opts.vendorDivisionId ?? null
  const userId = session.user.id

  const records = rows
    .map((row) => {
      const inventoryNumber = cell(row, "inventoryNumber")
      const description = cell(row, "description")
      const transactionDate = parseDate(cell(row, "transactionDate"))
      const unitCost = parseMoney(cell(row, "unitCost"))

      // Required gates: a usable SKU (number OR description) and a date.
      if (!inventoryNumber && !description) return null
      if (!transactionDate) return null

      const rawQty = parseInt(cell(row, "quantity") || "1", 10)
      const quantity = Number.isFinite(rawQty) && rawQty >= 1 ? rawQty : 1

      const explicitExtended = parseMoney(cell(row, "extendedPrice"))
      const extendedPrice =
        explicitExtended > 0 ? explicitExtended : unitCost * quantity

      const rawCategory = cell(row, "category") || undefined
      const category = rawCategory
        ? canonicalizeCategoryName(rawCategory) || rawCategory
        : null

      return {
        vendorId,
        vendorDivisionId: divisionId,
        vendorName: session.vendor.name ?? null,
        inventoryNumber: inventoryNumber || description || "Unknown",
        inventoryDescription: description || inventoryNumber || "Unknown item",
        vendorItemNo: cell(row, "vendorItemNo") || null,
        manufacturerNo: cell(row, "manufacturerNo") || null,
        poNumber: cell(row, "poNumber") || null,
        unitCost,
        extendedPrice,
        quantity,
        transactionDate,
        category,
        createdBy: userId,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (records.length === 0) {
    return { imported: 0, skipped: rows.length }
  }

  const result = await prisma.vendorCogRecord.createMany({ data: records })

  await logAudit({
    userId,
    action: "vendor_cog.imported",
    entityType: "vendor_cog_record",
    metadata: {
      imported: result.count,
      skipped: rows.length - records.length,
      fileName: opts.fileName ?? null,
      vendorDivisionId: divisionId,
      rowCount: rows.length,
    },
  })

  return {
    imported: result.count,
    skipped: rows.length - records.length,
  }
}
