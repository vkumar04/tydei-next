/**
 * Shared pricing-file reader for the prospective-analysis surfaces
 * (Pricing tab + the proposal "add the price file" ask, 2026-06-10).
 *
 * 2026-06-13 (uploader improvements 1+2): the file READER moved to
 * components/shared/uploads/read-tabular-file.ts (re-exported below so
 * existing imports keep working). This module keeps the analyzer's
 * row→item mapping, which now accepts a `mappingOverride` from the
 * shared <PricingFileDropzone> column-mapping fallback.
 */

import type { PricingFileItem } from "@/lib/prospective-analysis/pricing-file-analysis"
import {
  ITEM_NUMBER_ALIASES,
  DESCRIPTION_ALIASES,
  UNIT_PRICE_ALIASES,
} from "@/lib/utils/parse-pricing-file"
import {
  norm,
  overrideIndex,
  type ResolvedMapping,
  type UploadFieldSpec,
} from "@/components/shared/uploads/field-spec"

// Canonical reader now lives in the shared uploads module.
export { readPricingRows } from "@/components/shared/uploads/read-tabular-file"

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

// Analyzer-local alias lists (current/proposed price + qty). The SKU /
// description / generic price aliases are the canonical lists — bug
// 2026-06-10 ("Analysis for price not working"): a hand-rolled 7-alias
// copy missed "ReferenceNumber" and every row was dropped.
const CURRENT_PRICE_ALIASES = [
  "current_price",
  "currentprice",
  "unit_cost",
  "cost",
]

const PROPOSED_PRICE_ALIASES = [
  "proposed_price",
  "proposedprice",
  "new_price",
  "newprice",
  "quoted_price",
  "quotedprice",
  ...UNIT_PRICE_ALIASES,
]

const QTY_ALIASES = [
  "quantity",
  "qty",
  "quantity_ordered",
  "estimated_qty",
  "annual_qty",
]

/**
 * Field specs for the shared mapping-dialog fallback on the proposal
 * analyzer's price-file dropzone (uploader improvements 1, 2026-06-13).
 * Order matters: currentPrice resolves BEFORE proposedPrice so its
 * aliases ("cost", "unit_cost") can't be claimed by the broader
 * canonical price list (resolveMapping excludes claimed headers).
 */
export const ANALYZER_PRICE_FILE_SPECS: UploadFieldSpec[] = [
  {
    key: "itemNumber",
    label: "Item number",
    aliases: ITEM_NUMBER_ALIASES,
    required: true,
    kind: "text",
  },
  {
    key: "description",
    label: "Description",
    aliases: [...DESCRIPTION_ALIASES, "product_name"],
    kind: "text",
  },
  {
    key: "currentPrice",
    label: "Current price (what you pay today)",
    aliases: CURRENT_PRICE_ALIASES,
    kind: "number",
  },
  {
    key: "proposedPrice",
    label: "Proposed price",
    aliases: PROPOSED_PRICE_ALIASES,
    kind: "number",
  },
  {
    key: "quantity",
    label: "Estimated annual quantity",
    aliases: QTY_ALIASES,
    kind: "number",
  },
]

export function pricingRowsToItems(
  headers: string[],
  rows: Record<string, string>[],
  /**
   * From the shared <PricingFileDropzone> mapping dialog — when
   * provided, the user's columns FULLY replace auto-detection
   * (uploader improvements 1, 2026-06-13).
   */
  mappingOverride?: ResolvedMapping,
): PricingFileItem[] {
  const normHeaders = headers.map(norm)
  // Canonical alias lists from lib/utils/parse-pricing-file.ts — do NOT
  // inline a local list here. Bug 2026-06-10 ("Analysis for price not
  // working"): a hand-rolled 7-alias copy missed "ReferenceNumber"
  // (the Arthrex demo file's SKU header) and every row was dropped.
  let idxItem: number
  let idxDesc: number
  let idxCurrent: number
  let idxProposed: number
  let idxQty: number
  if (mappingOverride) {
    idxItem = overrideIndex(headers, mappingOverride, "itemNumber")
    idxDesc = overrideIndex(headers, mappingOverride, "description")
    idxCurrent = overrideIndex(headers, mappingOverride, "currentPrice")
    idxProposed = overrideIndex(headers, mappingOverride, "proposedPrice")
    idxQty = overrideIndex(headers, mappingOverride, "quantity")
  } else {
    idxItem = findIndex(normHeaders, ITEM_NUMBER_ALIASES)
    idxDesc = findIndex(normHeaders, [...DESCRIPTION_ALIASES, "product_name"])
    // Current price resolves FIRST so its aliases ("cost", "unit_cost")
    // can't be claimed by the broader canonical price list below.
    idxCurrent = findIndex(normHeaders, CURRENT_PRICE_ALIASES)
    idxProposed = findIndex(normHeaders, PROPOSED_PRICE_ALIASES, idxCurrent)
    idxQty = findIndex(normHeaders, QTY_ALIASES)
  }

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
