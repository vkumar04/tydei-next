import { toast } from "sonner"
import {
  ITEM_NUMBER_ALIASES,
  DESCRIPTION_ALIASES,
  UNIT_PRICE_ALIASES,
  CATEGORY_ALIASES,
} from "@/lib/utils/parse-pricing-file"
import {
  norm,
  overrideIndex,
  type ResolvedMapping,
  type UploadFieldSpec,
} from "@/components/shared/uploads/field-spec"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import type { NewProposalState, ProposalProduct, FileUploadProgressState, TermSuggestionsState } from "./types"

// ─── File parsing + column resolution ─────────────────────────────
// Bugs 2026-06-13 ("Pricing file must have a product name or reference
// number column" / "Usage file must have a product name column" on the
// real vendor exports): this file used to hand-roll BOTH the file
// parsing (FileReader.readAsText — XLSX read as binary garbage, no BOM
// strip, no CRLF normalization) AND a third copy of the header-alias
// lists, which missed "ReferenceNumber"-class SKU headers. Parsing now
// goes through the shared <PricingFileDropzone> (readPricingRows: CSV
// client-side with BOM/CRLF/quote handling; XLSX/XLS via
// /api/parse-file) and column detection through the canonical alias
// lists in lib/utils/parse-pricing-file.ts (invariants table:
// "Pricing-file header detection") — NEVER inline a copy. Builder-only
// extras ("Product Name", proposed_price, cost-basis, the usage-file
// columns) stay here as SECONDARY aliases behind the canonical lists.

function findExact(normHeaders: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = normHeaders.indexOf(norm(alias))
    if (idx >= 0) return idx
  }
  return -1
}

function findContains(normHeaders: string[], needles: string[]): number {
  const normNeedles = needles.map(norm)
  return normHeaders.findIndex((h) => normNeedles.some((n) => h.includes(n)))
}

// Builder-specific SECONDARY aliases (canonical lists come first).
const NAME_ALIASES = [...DESCRIPTION_ALIASES, "product_name", "name", "product"]
const QTY_ALIASES = ["quantity", "qty", "volume", "units", "quantity_ordered"]
const COST_BASIS_ALIASES = ["cost_basis", "cog", "cost_of_goods", "vendor_cost"]
// What the facility pays TODAY — feeds the Deal Scorer's Current-column
// prefill (ProposalProduct.currentPrice). There is no canonical
// current-price list in lib/utils/parse-pricing-file.ts (the analyzer
// keeps its own too), so these are builder-local. Deliberately NOT
// including bare "cost"/"unit_cost": in a builder pricing file those
// mean the proposed price (UNIT_PRICE_ALIASES).
const CURRENT_PRICE_ALIASES = [
  "current_price",
  "current price",
  "current unit price",
  "current cost",
  "today's price",
  "existing price",
]

function findCategoryIdx(normHeaders: string[]): number {
  const exact = findExact(normHeaders, CATEGORY_ALIASES)
  if (exact >= 0) return exact
  // Pre-existing contains-fallback so "Type" / "Class"-flavored headers
  // still count as a category column.
  return findContains(normHeaders, ["category", "type", "class"])
}

// ─── Field specs for the shared <PricingFileDropzone> ──────────────
// (uploader improvements 1, 2026-06-13). Aliases IMPORT the canonical
// lists; `contains` carries the builder's legacy substring fallbacks so
// auto-detection in the mapping dialog matches what the mappers do.

export const BUILDER_PRICING_UPLOAD_SPECS: UploadFieldSpec[] = [
  { key: "name", label: "Product name", aliases: NAME_ALIASES, kind: "text" },
  { key: "ref", label: "Reference number", aliases: ITEM_NUMBER_ALIASES, kind: "text" },
  // Order matters: currentPrice resolves BEFORE the proposed price so
  // resolveMapping's claimed-header exclusion keeps the broad price
  // aliases / contains-"price" fallback from stealing a "Current Price"
  // column (mirrors ANALYZER_PRICE_FILE_SPECS).
  {
    key: "currentPrice",
    label: "Current price (what the facility pays today)",
    aliases: CURRENT_PRICE_ALIASES,
    kind: "number",
  },
  {
    key: "price",
    label: "Proposed price",
    aliases: ["proposed_price", "proposedprice", ...UNIT_PRICE_ALIASES],
    contains: ["price"],
    kind: "number",
  },
  { key: "qty", label: "Quantity", aliases: QTY_ALIASES, kind: "number" },
  { key: "costBasis", label: "Cost basis", aliases: COST_BASIS_ALIASES, kind: "number" },
  {
    key: "category",
    label: "Category",
    aliases: CATEGORY_ALIASES,
    contains: ["category", "type", "class"],
    kind: "text",
  },
]

/**
 * "Either of two" can't be a per-field `required` — the pricing file
 * needs a product name OR a reference number. Wired into the dropzone's
 * `validate` prop.
 */
export function validateBuilderPricingMapping(
  mapping: ResolvedMapping,
): string | null {
  if (mapping.name === null && mapping.ref === null) {
    return "Map either Product name or Reference number — at least one is required."
  }
  return null
}

export const BUILDER_USAGE_UPLOAD_SPECS: UploadFieldSpec[] = [
  {
    key: "name",
    label: "Product name",
    aliases: NAME_ALIASES,
    // Legacy fallback: anything "productname"/"description"-flavored.
    contains: ["productname", "description"],
    required: true,
    kind: "text",
  },
  {
    key: "ref",
    label: "Reference number",
    aliases: ITEM_NUMBER_ALIASES,
    contains: ["ref", "sku", "itemnumber", "partnumber"],
    kind: "text",
  },
  {
    key: "date",
    label: "Transaction date",
    aliases: [],
    contains: ["date", "ordered"],
    kind: "date",
  },
  {
    key: "qty",
    label: "Quantity",
    aliases: QTY_ALIASES,
    contains: ["quantity", "qty"],
    kind: "number",
  },
  {
    key: "unitCost",
    label: "Unit cost",
    aliases: ["unit_cost", "unit_price"],
    contains: ["unitcost", "unitprice", "price"],
    kind: "number",
  },
  {
    key: "extendedCost",
    label: "Extended cost (line total)",
    // Exact-only legacy matches (h === "total" / "cost" / "revenue").
    aliases: ["total", "cost", "revenue"],
    contains: [
      "extended", "totalcost", "linetotal", "amount", "spend",
      "totalprice", "extcost", "extprice", "lineamount",
      "invoiceamount", "costtotal", "pricetotal",
    ],
    kind: "number",
  },
  {
    key: "category",
    label: "Category",
    aliases: CATEGORY_ALIASES,
    contains: ["category", "type", "class"],
    kind: "text",
  },
  { key: "vendor", label: "Vendor", aliases: [], contains: ["vendor"], kind: "text" },
]

// Self-service failure toasts (bugs 2026-06-13): show the headers we
// actually saw so the user can fix the file without filing a bug.
function headerPreview(headers: string[]): string {
  return (
    headers
      .slice(0, 6)
      .map((h) => `"${h}"`)
      .join(", ") + (headers.length > 6 ? ", …" : "")
  )
}

const parseMoney = (v: string): number => parseFloat(v.replace(/[$,]/g, "")) || 0

/**
 * Aggregation key for a file row: the normalized SKU when a reference
 * number exists (canonical `normalizeSku` — SKUs must never be compared
 * raw, CLAUDE.md), else the lowercased product name. One key = one
 * proposal product, no matter how many invoice LINES the file has.
 */
/** Round to cents — seeded dollar figures must not carry float tails
 *  (Charles 2026-07-05: "3924864.7300000004" in Projected Annual Spend). */
const toCents = (n: number): number => Math.round(n * 100) / 100

const productKey = (refNumber: string | undefined, productName: string): string =>
  normalizeSku(refNumber) || productName.trim().toLowerCase()

// ─── Pricing rows → proposal products (pure; unit-tested) ─────────

export interface MappedPricing {
  products: ProposalProduct[]
  totalSpend: number
  totalVolume: number
  distinctCategories: string[]
  detectedCategory: string | null
}

export type MapPricingResult =
  | ({ ok: true } & MappedPricing)
  | { ok: false; reason: "missing-name-and-ref" }

export function mapPricingRows(
  headers: string[],
  rows: Record<string, string>[],
  /**
   * From the shared <PricingFileDropzone> mapping dialog — when
   * provided, the user's columns FULLY replace auto-detection
   * (uploader improvements 1, 2026-06-13).
   */
  mappingOverride?: ResolvedMapping,
): MapPricingResult {
  const normHeaders = headers.map(norm)

  let nameIdx: number
  let refIdx: number
  let currentPriceIdx: number
  let priceIdx: number
  let qtyIdx: number
  let costIdx: number
  let categoryIdx: number
  if (mappingOverride) {
    nameIdx = overrideIndex(headers, mappingOverride, "name")
    refIdx = overrideIndex(headers, mappingOverride, "ref")
    currentPriceIdx = overrideIndex(headers, mappingOverride, "currentPrice")
    priceIdx = overrideIndex(headers, mappingOverride, "price")
    qtyIdx = overrideIndex(headers, mappingOverride, "qty")
    costIdx = overrideIndex(headers, mappingOverride, "costBasis")
    categoryIdx = overrideIndex(headers, mappingOverride, "category")
  } else {
    nameIdx = findExact(normHeaders, NAME_ALIASES)
    refIdx = findExact(normHeaders, ITEM_NUMBER_ALIASES)
    // Current price resolves first so the contains-"price" fallback
    // below can't claim a "Current Price" column as the proposed price.
    currentPriceIdx = findExact(normHeaders, CURRENT_PRICE_ALIASES)
    // proposed_price first (a proposal file's own column), then the
    // canonical price list, then the legacy contains-"price" fallback so
    // headers like "List Price" still resolve as they did before.
    priceIdx = findExact(normHeaders, [
      "proposed_price",
      "proposedprice",
      ...UNIT_PRICE_ALIASES,
    ])
    if (priceIdx === -1) {
      priceIdx = normHeaders.findIndex(
        (h, i) => i !== currentPriceIdx && h.includes("price"),
      )
    }
    qtyIdx = findExact(normHeaders, QTY_ALIASES)
    costIdx = findExact(normHeaders, COST_BASIS_ALIASES)
    categoryIdx = findCategoryIdx(normHeaders)
  }

  if (nameIdx === -1 && refIdx === -1) {
    return { ok: false, reason: "missing-name-and-ref" }
  }

  const get = (row: Record<string, string>, idx: number): string =>
    idx >= 0 ? (row[headers[idx]] ?? "") : ""

  // Per-SKU aggregation (Charles 2026-06-30, "SYK Usage ONLY.xlsx"):
  // real facility exports are raw INVOICE-LINE dumps — the same SKU
  // repeats across dates. Emitting one product per ROW turned a 601-SKU
  // book into thousands of "items", and the usage merge then assigned
  // each duplicate row the SKU's TOTAL 12-month volume, inflating
  // totalProposedCost by the duplicate count (measured $111M from a
  // $3.9M book). One SKU = one product: Σ qty, spend-weighted unit
  // price. Genuine pricing files (unique SKUs) behave exactly as before.
  interface PricingAgg {
    productName: string
    refNumber?: string
    currentPrice?: number
    costBasis?: number
    sumQty: number
    /** Σ price×qty over rows with price>0 AND qty>0 (weighted numerator). */
    sumPriceTimesQty: number
    /** Σ qty over rows with price>0 AND qty>0 (weighted denominator). */
    qtyWithPrice: number
    /** Simple-average fallback for files without a qty column. */
    sumPrice: number
    priceCount: number
  }
  const grouped = new Map<string, PricingAgg>()
  let totalSpend = 0
  let totalVolume = 0
  const categoryCounts: Record<string, number> = {}

  for (const row of rows) {
    const productName = (nameIdx !== -1 ? get(row, nameIdx) : get(row, refIdx)).trim()
    if (!productName) continue

    const refNumber = refIdx !== -1 ? get(row, refIdx).trim() || undefined : undefined
    const currentPrice =
      currentPriceIdx !== -1 ? parseMoney(get(row, currentPriceIdx)) || undefined : undefined
    const price = priceIdx !== -1 ? parseMoney(get(row, priceIdx)) : 0
    const qty = qtyIdx !== -1 ? parseInt(get(row, qtyIdx).replace(/,/g, "")) || 0 : 0
    const costBasis = costIdx !== -1 ? parseMoney(get(row, costIdx)) || undefined : undefined
    const category = categoryIdx !== -1 ? get(row, categoryIdx).trim() : undefined

    if (category) {
      categoryCounts[category] = (categoryCounts[category] || 0) + 1
    }

    const key = productKey(refNumber, productName)
    let agg = grouped.get(key)
    if (!agg) {
      agg = {
        productName,
        refNumber,
        currentPrice,
        costBasis,
        sumQty: 0,
        sumPriceTimesQty: 0,
        qtyWithPrice: 0,
        sumPrice: 0,
        priceCount: 0,
      }
      grouped.set(key, agg)
    } else {
      // First positive value wins for the optional per-product fields.
      if (agg.currentPrice == null && currentPrice != null) agg.currentPrice = currentPrice
      if (agg.costBasis == null && costBasis != null) agg.costBasis = costBasis
      if (!agg.refNumber && refNumber) agg.refNumber = refNumber
    }
    agg.sumQty += qty
    if (price > 0) {
      agg.sumPrice += price
      agg.priceCount++
      if (qty > 0) {
        agg.sumPriceTimesQty += price * qty
        agg.qtyWithPrice += qty
      }
    }

    totalSpend += price * qty
    totalVolume += qty
  }

  const products: ProposalProduct[] = []
  for (const agg of grouped.values()) {
    // Unit price: spend-weighted (Σ price×qty ÷ Σ qty) when quantities
    // exist, else the simple average of the SKU's listed prices.
    const proposedPrice =
      agg.qtyWithPrice > 0
        ? agg.sumPriceTimesQty / agg.qtyWithPrice
        : agg.priceCount > 0
          ? agg.sumPrice / agg.priceCount
          : 0
    products.push({
      benchmarkId: `pricing-${Date.now()}-${products.length}`,
      productName: agg.productName,
      refNumber: agg.refNumber,
      proposedPrice,
      currentPrice: agg.currentPrice,
      projectedVolume: agg.sumQty,
      costBasis: agg.costBasis,
      fromPricingFile: true,
    })
  }

  const distinctCategories = Object.keys(categoryCounts).filter(Boolean)
  const detectedCategory =
    distinctCategories.length > 0
      ? Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null

  return { ok: true, products, totalSpend, totalVolume, distinctCategories, detectedCategory }
}

/**
 * Downstream import for the builder's pricing upload (uploader
 * improvements 1, 2026-06-13): the shared <PricingFileDropzone> owns
 * file reading + column mapping and hands us parsed rows + the
 * confirmed mapping. Everything downstream (merge with usage, #66
 * category auto-select, toasts) is unchanged from the pre-dropzone
 * handlePricingFileUpload.
 */
export async function handlePricingRowsImport(
  headers: string[],
  rows: Record<string, string>[],
  mapping: ResolvedMapping,
  setFileUploadProgress: React.Dispatch<React.SetStateAction<FileUploadProgressState>>,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
  /**
   * Charles 2026-04-26 (#66): when supplied, every distinct category
   * found in the pricing file is appended to the user's custom-
   * category list AND auto-selected on the proposal — so the vendor
   * doesn't have to manually retype categories that the upload
   * already discovered.
   */
  setCustomCategories?: React.Dispatch<React.SetStateAction<string[]>>,
) {
  setFileUploadProgress({ isLoading: true, type: "pricing", progress: 30, message: "Parsing pricing data..." })

  try {
      const mapped = mapPricingRows(headers, rows, mapping)

      if (!mapped.ok) {
        // Unreachable through the dropzone (validateBuilderPricingMapping
        // blocks Import) — kept as a guard for programmatic callers.
        setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
        toast.error(
          `Pricing file must have a product name or reference number column — found: ${headerPreview(headers)}`,
        )
        return
      }

      setFileUploadProgress({ isLoading: true, type: "pricing", progress: 60, message: "Loading products..." })

      const { products, totalSpend, totalVolume, distinctCategories, detectedCategory } = mapped

      if (products.length === 0) {
        setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
        toast.error("No valid products found in pricing file")
        return
      }

      // Charles 2026-04-26 (#66): append every distinct category from
      // the pricing file to the proposal's selected categories so the
      // vendor doesn't have to re-add them manually.
      if (distinctCategories.length > 0 && setCustomCategories) {
        setCustomCategories((prev) => {
          const existing = new Set(prev.map((c) => c.toLowerCase()))
          const additions = distinctCategories.filter(
            (c) => !existing.has(c.toLowerCase()),
          )
          return additions.length > 0 ? [...prev, ...additions] : prev
        })
      }

      setNewProposal(prev => {
        if (prev.products.length > 0 && prev.products.some(p => !p.fromPricingFile)) {
          const existingUsage = prev.products.filter(p => !p.fromPricingFile)

          const normalizeRef = (ref: string): string => {
            return (ref || "").toString().trim().toLowerCase()
              .replace(/^0+/, "").replace(/[-_.\s]/g, "").replace(/[^a-z0-9]/g, "")
          }

          let matched = 0
          for (const product of products) {
            // EXACT normalized matching only (2026-07-04 follow-up): the old
            // mutual-substring match cross-matched near-identical SKUs
            // (…500 vs …5000) and near-identical names, folding one
            // product's volume onto another. When BOTH sides carry a ref,
            // the refs decide — names are only consulted when a ref is
            // missing on either side, and then only as exact (normalized)
            // equality.
            const usageMatch = existingUsage.find(u => {
              const usageRef = normalizeRef(u.refNumber || "")
              const pricingRef = normalizeRef(product.refNumber || "")
              if (usageRef && pricingRef) return usageRef === pricingRef
              return (
                product.productName.trim().toLowerCase() ===
                u.productName.trim().toLowerCase()
              )
            })
            if (usageMatch) {
              product.projectedVolume = usageMatch.projectedVolume || product.projectedVolume
              product.historicalAvgPrice = usageMatch.historicalAvgPrice
              product.historicalAvgVolume = usageMatch.historicalAvgVolume
              product.monthlyUsage = usageMatch.monthlyUsage
              product.refNumber = product.refNumber || usageMatch.refNumber
              matched++
            }
          }

          toast.success(`Merged pricing with usage: ${matched} matched of ${products.length} products`)
        }

        // Auto-select every distinct category from the pricing file
        // alongside whatever the vendor already had selected.
        const mergedCategories = Array.from(
          new Set([...prev.productCategories, ...distinctCategories]),
        )
        return {
          ...prev,
          products: products,
          // projectedSpend is a USER-OWNED assumption (Vick: "list ≠
          // entered value") — files only SEED it when it's still 0,
          // never overwrite a typed value.
          projectedSpend: prev.projectedSpend > 0 ? prev.projectedSpend : toCents(totalSpend),
          projectedVolume: totalVolume,
          productCategory:
            prev.productCategory ||
            detectedCategory ||
            mergedCategories[0] ||
            "",
          productCategories: mergedCategories,
        }
      })

      setFileUploadProgress({ isLoading: false, type: null, progress: 100, message: "" })
      // Charles 2026-04-26: explicit category-detection feedback. Users
      // were uploading pricing files and seeing nothing about categories
      // (#66 wired the wiring, but if the CSV had no Category/Type/Class
      // column, nothing surfaces and the user thinks validation
      // silently failed). Tell them either way.
      if (distinctCategories.length > 0) {
        toast.success(
          `Loaded ${products.length} products. Detected ${distinctCategories.length} categor${distinctCategories.length === 1 ? "y" : "ies"}: ${distinctCategories.slice(0, 4).join(", ")}${distinctCategories.length > 4 ? "…" : ""}. Review the Product Categories chips above to confirm.`,
        )
      } else {
        toast.success(`Loaded ${products.length} products from pricing file`)
        toast.warning(
          "No category column found in the pricing file (we look for headers like 'Category', 'Type', or 'Class'). Pick a Product Category manually before submitting the proposal so the engine can scope rebates correctly.",
          { duration: 8_000 },
        )
      }
  } catch (err) {
    console.error("Pricing rows import error:", err)
    setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
    toast.error("Failed to import pricing file")
  }
}

// ─── Usage rows → proposal products (pure; unit-tested) ───────────

/** 50k-row cap (was a 50k-LINE cap on the raw CSV text pre-2026-06-13;
 *  now applies to parsed data rows so XLSX files get the same guard). */
export const MAX_USAGE_ROWS = 50_000

export interface MappedUsage {
  products: ProposalProduct[]
  totalVolume: number
  totalRevenue: number
  detectedCategory: string | null
  /** transaction rows aggregated (rows with a product name, post-cap) */
  processedRows: number
  truncated: boolean
}

export type MapUsageResult =
  | ({ ok: true } & MappedUsage)
  | { ok: false; reason: "missing-name" }

export function mapUsageRows(
  headers: string[],
  rows: Record<string, string>[],
  /**
   * From the shared <PricingFileDropzone> mapping dialog — when
   * provided, the user's columns FULLY replace auto-detection
   * (uploader improvements 1, 2026-06-13).
   */
  mappingOverride?: ResolvedMapping,
): MapUsageResult {
  const normHeaders = headers.map(norm)

  let vendorIdx: number
  let dateIdx: number
  let nameIdx: number
  let refIdx: number
  let qtyIdx: number
  let unitCostIdx: number
  let extendedCostIdx: number
  let categoryIdx: number
  if (mappingOverride) {
    vendorIdx = overrideIndex(headers, mappingOverride, "vendor")
    dateIdx = overrideIndex(headers, mappingOverride, "date")
    nameIdx = overrideIndex(headers, mappingOverride, "name")
    refIdx = overrideIndex(headers, mappingOverride, "ref")
    qtyIdx = overrideIndex(headers, mappingOverride, "qty")
    unitCostIdx = overrideIndex(headers, mappingOverride, "unitCost")
    extendedCostIdx = overrideIndex(headers, mappingOverride, "extendedCost")
    categoryIdx = overrideIndex(headers, mappingOverride, "category")
  } else {
    vendorIdx = findContains(normHeaders, ["vendor"])
    dateIdx = findContains(normHeaders, ["date", "ordered"])
    // Canonical description aliases first; then the legacy contains
    // behavior ("Product Name" / anything "product" that isn't a ref).
    nameIdx = findExact(normHeaders, NAME_ALIASES)
    if (nameIdx === -1) {
      nameIdx = normHeaders.findIndex(
        (h) =>
          h.includes("productname") ||
          h.includes("description") ||
          (h.includes("product") && !h.includes("ref")),
      )
    }
    refIdx = findExact(normHeaders, ITEM_NUMBER_ALIASES)
    if (refIdx === -1) {
      refIdx = findContains(normHeaders, ["ref", "sku", "itemnumber", "partnumber"])
    }
    qtyIdx = findExact(normHeaders, QTY_ALIASES)
    if (qtyIdx === -1) qtyIdx = findContains(normHeaders, ["quantity", "qty"])
    // "Unit Cost" must keep resolving as the per-unit price (as today);
    // the generic contains-"price" fallback comes last.
    unitCostIdx = findExact(normHeaders, ["unit_cost", "unit_price"])
    if (unitCostIdx === -1) {
      unitCostIdx = findContains(normHeaders, ["unitcost", "unitprice", "price"])
    }
    // Existing extended-cost alias set, normalized (e.g. "total cost" →
    // "totalcost").
    extendedCostIdx = normHeaders.findIndex(
      (h) =>
        [
          "extended", "totalcost", "linetotal", "amount", "spend",
          "totalprice", "extcost", "extprice", "lineamount",
          "invoiceamount", "costtotal", "pricetotal",
        ].some((n) => h.includes(n)) ||
        h === "total" || h === "cost" || h === "revenue",
    )
    categoryIdx = findCategoryIdx(normHeaders)
  }

  if (nameIdx === -1) {
    return { ok: false, reason: "missing-name" }
  }

  const get = (row: Record<string, string>, idx: number): string =>
    idx >= 0 ? (row[headers[idx]] ?? "") : ""

  const productUsageMap: Record<string, {
    productName: string
    refNumber?: string
    vendor?: string
    category?: string
    transactions: {
      date: Date
      month: string
      quantity: number
      unitCost: number
      extendedCost: number
    }[]
  }> = {}

  const truncated = rows.length > MAX_USAGE_ROWS
  const cappedRows = truncated ? rows.slice(0, MAX_USAGE_ROWS) : rows
  let processedRows = 0

  for (const row of cappedRows) {
    const productName = get(row, nameIdx).trim()
    if (!productName) continue

    const refNumber = refIdx !== -1 ? get(row, refIdx).trim() || undefined : undefined
    // normalizeSku key (was raw .toLowerCase()): SKU case/whitespace
    // variants across invoice lines must land in the SAME product.
    const key = productKey(refNumber, productName)

    if (!productUsageMap[key]) {
      productUsageMap[key] = {
        productName,
        refNumber,
        vendor: vendorIdx !== -1 ? get(row, vendorIdx).trim() : undefined,
        category: categoryIdx !== -1 ? get(row, categoryIdx).trim() : undefined,
        transactions: [],
      }
    }

    let date = new Date()
    let month = ""
    if (dateIdx !== -1 && get(row, dateIdx)) {
      const dateStr = get(row, dateIdx).trim()
      const mdyMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (mdyMatch) {
        date = new Date(parseInt(mdyMatch[3]), parseInt(mdyMatch[1]) - 1, parseInt(mdyMatch[2]))
        month = `${mdyMatch[3]}-${mdyMatch[1].padStart(2, "0")}`
      } else {
        const ymdMatch = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
        if (ymdMatch) {
          date = new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]))
          month = `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}`
        }
      }
    }
    if (!month) {
      month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    }

    const quantity = qtyIdx !== -1 ? parseInt(get(row, qtyIdx).replace(/,/g, "")) || 0 : 1
    const unitCost = unitCostIdx !== -1 ? parseMoney(get(row, unitCostIdx)) : 0
    const extendedCost = extendedCostIdx !== -1
      ? parseMoney(get(row, extendedCostIdx)) || (unitCost * quantity)
      : (unitCost * quantity)

    productUsageMap[key].transactions.push({
      date,
      month,
      quantity,
      unitCost,
      extendedCost,
    })
    processedRows++
  }

  const products: ProposalProduct[] = []
  let totalVolume = 0
  let totalRevenue = 0
  const categoryCounts: Record<string, number> = {}

  for (const [, data] of Object.entries(productUsageMap)) {
    const monthlyAggregates: Record<string, { volume: number; revenue: number; totalUnitCost: number; count: number }> = {}

    for (const tx of data.transactions) {
      if (!monthlyAggregates[tx.month]) {
        monthlyAggregates[tx.month] = { volume: 0, revenue: 0, totalUnitCost: 0, count: 0 }
      }
      monthlyAggregates[tx.month].volume += tx.quantity
      monthlyAggregates[tx.month].revenue += tx.extendedCost
      monthlyAggregates[tx.month].totalUnitCost += tx.unitCost
      monthlyAggregates[tx.month].count++
    }

    const monthlyUsage = Object.entries(monthlyAggregates)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, agg]) => ({
        month: m,
        volume: agg.volume,
        revenue: agg.revenue,
        avgPrice: agg.count > 0 ? agg.totalUnitCost / agg.count : 0,
      }))

    const totalVol = monthlyUsage.reduce((sum, m) => sum + m.volume, 0)
    const totalRev = monthlyUsage.reduce((sum, m) => sum + m.revenue, 0)
    // Historical unit price = Σ extended ÷ Σ qty (spend-weighted). The
    // old unweighted mean-of-monthly-means over- or under-stated the
    // price whenever volume was uneven across months.
    const avgPrice =
      totalVol > 0
        ? totalRev / totalVol
        : monthlyUsage.length > 0
          ? monthlyUsage.reduce((sum, m) => sum + m.avgPrice, 0) / monthlyUsage.length
          : 0

    if (data.category) {
      categoryCounts[data.category] = (categoryCounts[data.category] || 0) + 1
    }

    products.push({
      benchmarkId: `usage-${Date.now()}-${products.length}`,
      productName: data.productName,
      refNumber: data.refNumber,
      proposedPrice: 0,
      fromPricingFile: false,
      projectedVolume: totalVol,
      historicalAvgPrice: avgPrice,
      historicalAvgVolume: totalVol,
      monthlyUsage: monthlyUsage.length > 0 ? monthlyUsage : undefined,
    })

    totalVolume += totalVol
    totalRevenue += totalRev
  }

  // Highest-revenue products first (matches the pre-2026-06-13 order).
  products.sort((a, b) => {
    const aRev = a.monthlyUsage?.reduce((sum, m) => sum + m.revenue, 0) || 0
    const bRev = b.monthlyUsage?.reduce((sum, m) => sum + m.revenue, 0) || 0
    return bRev - aRev
  })

  const detectedCategory =
    Object.keys(categoryCounts).length > 0
      ? Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null

  return { ok: true, products, totalVolume, totalRevenue, detectedCategory, processedRows, truncated }
}

/**
 * Downstream import for the builder's usage upload (uploader
 * improvements 1, 2026-06-13): rows + confirmed mapping arrive from the
 * shared <PricingFileDropzone>; the aggregation, pricing-merge and
 * toast behavior is unchanged from the pre-dropzone
 * handleUsageFileUpload.
 */
export async function handleUsageRowsImport(
  headers: string[],
  rows: Record<string, string>[],
  mapping: ResolvedMapping,
  setFileUploadProgress: React.Dispatch<React.SetStateAction<FileUploadProgressState>>,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
) {
  try {
      const rowCount = Math.min(rows.length, MAX_USAGE_ROWS)
      setFileUploadProgress({
        isLoading: true,
        type: "usage",
        progress: 30,
        message: `Processing ${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}...`,
      })
      // Yield once so the progress state paints before the synchronous
      // aggregation pass over (up to) 50k rows.
      await new Promise(resolve => setTimeout(resolve, 0))

      const mapped = mapUsageRows(headers, rows, mapping)

      if (!mapped.ok) {
        // Unreachable through the dropzone (name is `required` on the
        // usage spec) — kept as a guard for programmatic callers.
        setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
        toast.error(
          `Usage file must have a product name column — found: ${headerPreview(headers)}`,
        )
        return
      }

      const { products, totalVolume, totalRevenue, detectedCategory, processedRows, truncated } = mapped

      if (products.length === 0) {
        setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
        toast.error("No valid product data found in usage file")
        return
      }

      setFileUploadProgress({ isLoading: true, type: "usage", progress: 90, message: "Matching with pricing data..." })

      let matchedWithPricing = 0
      let addedNew = 0

      setNewProposal(prev => {
        if (prev.products.length > 0) {
          const updatedProducts = [...prev.products]

          const normalizeRef = (ref: string): string => {
            return (ref || "").toString().trim().toLowerCase()
              .replace(/^0+/, "").replace(/[-_.\s]/g, "").replace(/[^a-z0-9]/g, "")
          }

          for (const usageProduct of products) {
            const existingIdx = updatedProducts.findIndex(p => {
              const usageRef = normalizeRef(usageProduct.refNumber || "")
              const pricingRef = normalizeRef(p.refNumber || "")
              if (usageRef && pricingRef && (usageRef === pricingRef || usageRef.includes(pricingRef) || pricingRef.includes(usageRef))) return true
              const pNameLower = p.productName.toLowerCase()
              const usageNameLower = usageProduct.productName.toLowerCase()
              return pNameLower === usageNameLower || pNameLower.includes(usageNameLower) || usageNameLower.includes(pNameLower)
            })

            if (existingIdx !== -1) {
              updatedProducts[existingIdx] = {
                ...updatedProducts[existingIdx],
                projectedVolume: usageProduct.projectedVolume,
                historicalAvgPrice: usageProduct.historicalAvgPrice,
                historicalAvgVolume: usageProduct.historicalAvgVolume,
                monthlyUsage: usageProduct.monthlyUsage,
                refNumber: updatedProducts[existingIdx].refNumber || usageProduct.refNumber,
              }
              matchedWithPricing++
            } else {
              addedNew++
            }
          }

          return {
            ...prev,
            products: updatedProducts,
            // Seed-only (user-owned assumption): a usage upload used to
            // ADD to projectedSpend, so a re-upload double-counted.
            projectedSpend: prev.projectedSpend > 0 ? prev.projectedSpend : toCents(totalRevenue),
            projectedVolume: prev.projectedVolume + totalVolume,
            totalOpportunity: prev.totalOpportunity + totalRevenue,
            productCategory: prev.productCategory || detectedCategory || prev.productCategory,
          }
        } else {
          addedNew = products.length
          return {
            ...prev,
            products: [...prev.products, ...products],
            // Seed-only (user-owned assumption) — same rule as above.
            projectedSpend: prev.projectedSpend > 0 ? prev.projectedSpend : toCents(totalRevenue),
            projectedVolume: prev.projectedVolume + totalVolume,
            totalOpportunity: prev.totalOpportunity + totalRevenue,
            productCategory: prev.productCategory || detectedCategory || prev.productCategory,
          }
        }
      })

      setFileUploadProgress({ isLoading: false, type: null, progress: 100, message: "" })

      if (truncated) {
        toast.warning(`File truncated: processed first ${MAX_USAGE_ROWS.toLocaleString()} rows of ${rows.length.toLocaleString()}`)
      }

      const matchInfo = matchedWithPricing > 0 ? ` Matched ${matchedWithPricing} products with pricing data.` : ""
      const skippedInfo = addedNew > 0 ? ` (${addedNew} usage-only products not in pricing file)` : ""
      toast.success(
        `Processed ${products.length} products from ${processedRows.toLocaleString()} transactions.` +
        matchInfo + skippedInfo
      )
  } catch (err) {
    console.error("Usage rows import error:", err)
    setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
    toast.error("Failed to import usage file")
  }
}

/**
 * Parses products from a plain-text description using simple
 * line-by-line regex rules — NOT AI. One product per line, expecting a
 * name, a price, and an optional unit count (e.g. "Primary Hip System
 * $8,500 50 units").
 *
 * Honesty rules (vendor-prospective audit H1.b): never fabricate
 * values. Lines without a recognizable price are skipped and reported;
 * missing volume stays 0 rather than defaulting to an invented number.
 */
export function parseProductsFromDescription(
  productDescription: string,
  currentProductCategory: string,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
  setProductDescription: (v: string) => void,
) {
  if (!productDescription.trim()) {
    toast.error("Enter a product description first")
    return
  }

  const descriptionLines = productDescription.split("\n").filter(l => l.trim())
  const products: ProposalProduct[] = []
  let skippedLines = 0
  let totalSpend = 0
  let totalVolume = 0

  const fullText = productDescription.toLowerCase()
  const categoryKeywords: Record<string, string[]> = {
    "Ortho-Spine": ["hip", "knee", "spine", "spinal", "orthopedic", "joint", "arthroplasty", "fusion", "implant"],
    "Cardiovascular": ["stent", "pacemaker", "cardiac", "heart", "vascular", "catheter", "angioplasty"],
    "Biologics": ["graft", "tissue", "biologic", "prp", "regenerat", "bone substitute", "allograft"],
    "General Surgery": ["surgical", "instrument", "stapler", "suture", "laparoscop"],
    "Disposables": ["glove", "gown", "mask", "syringe", "bandage", "gauze"],
  }
  let detectedCategory: string | null = null
  let maxMatches = 0
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    const matches = keywords.filter(kw => fullText.includes(kw)).length
    if (matches > maxMatches) {
      maxMatches = matches
      detectedCategory = category
    }
  }

  for (const line of descriptionLines) {
    const volumeMatch = line.match(/([\d,]+)\s*(?:units?|qty|quantity|pcs?|pieces?)/i)
    // Strip the volume expression first so its number can't be
    // mistaken for a price (e.g. "Widget 50 units" must NOT parse as
    // a $50 product).
    const lineWithoutVolume = volumeMatch ? line.replace(volumeMatch[0], "") : line
    const priceMatch = lineWithoutVolume.match(/\$?([\d,]+(?:\.\d{1,2})?)/)

    const productName = line
      .replace(/\$?[\d,]+(?:\.\d{1,2})?/g, "")
      .replace(/\d+\s*(?:units?|qty|quantity|pcs?|pieces?)/gi, "")
      .replace(/[-@:]/g, "")
      .trim()

    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0
    const volume = volumeMatch ? parseInt(volumeMatch[1].replace(/,/g, "")) || 0 : 0

    // A line only counts as parsed if it has a usable name AND an
    // explicit price. We never invent a price or a volume.
    if (productName.length > 3 && price > 0) {
      products.push({
        benchmarkId: `parsed-${Date.now()}-${products.length}`,
        productName: productName.substring(0, 50),
        proposedPrice: price,
        projectedVolume: volume,
      })
      totalSpend += price * volume
      totalVolume += volume
    } else {
      skippedLines++
    }
  }

  if (products.length === 0) {
    toast.error(
      'No products could be parsed from the description. Use one line per product with a name and a price, e.g. "Primary Hip System $8,500 50 units".',
    )
    return
  }

  setNewProposal(prev => ({
    ...prev,
    products: [...prev.products, ...products],
    // Seed-only: projectedSpend is a user-owned assumption — parsing a
    // description never overwrites (or adds to) a typed value.
    projectedSpend: prev.projectedSpend > 0 ? prev.projectedSpend : toCents(totalSpend),
    projectedVolume: prev.projectedVolume + totalVolume,
    productCategory: prev.productCategory || detectedCategory || prev.productCategory,
  }))

  setProductDescription("")
  const categoryMsg = detectedCategory && !currentProductCategory ? ` (Category: ${detectedCategory})` : ""
  toast.success(`Parsed ${products.length} product${products.length > 1 ? "s" : ""} from description${categoryMsg}`)
  if (skippedLines > 0) {
    toast.warning(
      `${skippedLines} line${skippedLines > 1 ? "s" : ""} could not be parsed (no price found) and ${skippedLines > 1 ? "were" : "was"} skipped`,
    )
  }
}

export function generateTermsFromNotes(
  newProposal: NewProposalState,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
): TermSuggestionsState["data"] {
  const notes = newProposal.aiNotes.toLowerCase()
  const generatedTerms: NewProposalState["terms"] = []
  const suggestedTerms: { type: string; description: string; rationale: string }[] = []
  const negotiationAdvice: string[] = []
  const riskFactors: string[] = []

  // ── Parse context signals from the notes ──────────────────────
  const spendMatch = newProposal.aiNotes.match(/\$?([\d,.]+)\s*(million|m|k|thousand)?\s*(annual\s*)?(spend|revenue)?/i)
  const shareMatch = newProposal.aiNotes.match(/(\d+)\s*%?\s*(?:market\s*)?share/i)
  const yearMatch = newProposal.aiNotes.match(/(\d+)\s*-?\s*year/i)
  const hasCompetitor = notes.includes("compet") || notes.includes("rival") || notes.includes("alternative")
  const hasExclusivity = notes.includes("exclusive") || notes.includes("primary") || notes.includes("sole source")
  const hasUrgency = notes.includes("urgent") || notes.includes("deadline") || notes.includes("end of month") || notes.includes("decision needed")
  const hasGrowth = notes.includes("growth") || notes.includes("increase") || notes.includes("expand")
  const hasTiered = notes.includes("tier") || notes.includes("volume") || notes.includes("incentive")
  const hasRelationship = notes.includes("relationship") || notes.includes("years") || notes.includes("loyal") || notes.includes("customer for")
  const contractYears = yearMatch ? parseInt(yearMatch[1]) : 0
  const sharePercent = shareMatch ? parseInt(shareMatch[1]) : hasExclusivity ? 70 : 0

  // ── Spend rebate ──────────────────────────────────────────────
  if (spendMatch || notes.includes("spend") || notes.includes("annual")) {
    let targetValue = newProposal.projectedSpend || 500000
    if (spendMatch && spendMatch[1]) {
      const num = parseFloat(spendMatch[1].replace(/,/g, ""))
      const multiplier = spendMatch[2]?.toLowerCase()
      if (multiplier === "million" || multiplier === "m") {
        targetValue = num * 1000000
      } else if (multiplier === "k" || multiplier === "thousand") {
        targetValue = num * 1000
      } else {
        targetValue = num
      }
    }
    const rebatePct = targetValue >= 1000000 ? 3.5 : targetValue >= 500000 ? 3 : 2.5
    generatedTerms.push({
      id: `suggested-spend-${Date.now()}`,
      termType: "spend_rebate",
      name: "Annual Spend Rebate",
      targetType: "spend",
      targetValue,
      rebatePercent: rebatePct,
      rebateType: "percent",
      tiers: [],
    })
    suggestedTerms.push({
      type: "Annual Spend Rebate",
      description: `${rebatePct}% rebate on ${targetValue >= 1000000 ? "$" + (targetValue / 1000000).toFixed(1) + "M" : "$" + (targetValue / 1000).toFixed(0) + "K"} annual spend commitment`,
      rationale: `A spend-based rebate locks in volume commitment. At this spend level, ${rebatePct}% is competitive with market benchmarks while maintaining healthy margins.`,
    })
    negotiationAdvice.push(
      `Push for: A higher spend threshold with a proportionally higher rebate (e.g., ${rebatePct + 0.5}% at 120% of target) to incentivize over-performance.`
    )
  }

  // ── Market share commitment ───────────────────────────────────
  if (shareMatch || hasExclusivity || notes.includes("market share") || notes.includes("partnership")) {
    generatedTerms.push({
      id: `suggested-share-${Date.now()}`,
      termType: "market_share_rebate",
      name: "Market Share Commitment",
      targetType: "market_share",
      targetValue: sharePercent,
      rebatePercent: sharePercent >= 60 ? 2.5 : 2,
      rebateType: "percent",
      tiers: [],
    })
    setNewProposal(prev => ({ ...prev, marketShareCommitment: sharePercent }))
    suggestedTerms.push({
      type: "Market Share Commitment",
      description: `${sharePercent}% share commitment with ${sharePercent >= 60 ? "2.5" : "2"}% compliance rebate`,
      rationale: hasExclusivity
        ? "Exclusivity requests justify a premium rebate — the vendor gains predictable volume while the facility gets pricing certainty."
        : `A ${sharePercent}% share target is achievable and demonstrates commitment without locking the facility into an unrealistic compliance burden.`,
    })
    if (sharePercent >= 70) {
      negotiationAdvice.push(
        "Concede on: Slightly higher rebate percentage for high share commitment — the guaranteed volume more than compensates."
      )
      riskFactors.push(`${sharePercent}% share commitment is aggressive. If the facility can't maintain compliance, rebate clawback could damage the relationship.`)
    }
    negotiationAdvice.push(
      "Push for: Quarterly compliance reporting rather than annual, so course-corrections can happen early."
    )
  }

  // ── Contract length ───────────────────────────────────────────
  if (yearMatch) {
    const years = parseInt(yearMatch[1])
    setNewProposal(prev => ({ ...prev, contractLength: years * 12 }))
    suggestedTerms.push({
      type: "Contract Duration",
      description: `${years}-year agreement with annual price escalator cap of 2-3%`,
      rationale: years >= 3
        ? "A multi-year deal provides revenue stability. Include a price escalator cap to protect against cost inflation while keeping the facility comfortable with long-term commitment."
        : "A shorter contract reduces lock-in risk for both parties. Consider including an auto-renewal clause with a 90-day opt-out window.",
    })
    if (years >= 3) {
      negotiationAdvice.push(
        `Push for: Annual review meetings built into the contract to discuss performance and adjust terms — this keeps the relationship active.`
      )
      negotiationAdvice.push(
        `Concede on: A 90-day termination clause after year 1 — it shows confidence in your value and reduces the facility's perceived risk.`
      )
    }
    if (years >= 5) {
      riskFactors.push("5+ year contracts carry product obsolescence risk. Consider including technology refresh clauses.")
    }
  }

  // ── Growth incentive ──────────────────────────────────────────
  if (hasGrowth) {
    generatedTerms.push({
      id: `suggested-growth-${Date.now()}`,
      termType: "volume_rebate",
      name: "Growth Incentive Rebate",
      targetType: "volume",
      targetValue: 10,
      rebatePercent: 2,
      rebateType: "percent",
      tiers: [],
    })
    suggestedTerms.push({
      type: "Growth Incentive",
      description: "2% bonus rebate for 10%+ year-over-year volume growth",
      rationale: "Growth-based incentives align both parties' interests. The vendor gains market share expansion while the facility is rewarded for consolidating purchases.",
    })
    negotiationAdvice.push(
      "Push for: Growth measured against a rolling baseline rather than a fixed baseline to prevent sandbagging in year 1."
    )
  }

  // ── Tiered volume rebate ──────────────────────────────────────
  if (hasTiered) {
    generatedTerms.push({
      id: `suggested-tiered-${Date.now()}`,
      termType: "volume_rebate",
      name: "Tiered Volume Rebate",
      targetType: "volume",
      targetValue: newProposal.projectedVolume || 100,
      rebatePercent: 0,
      rebateType: "percent",
      // Tier mins are UNITS (volume targetType); values are percent-of-spend.
      tiers: [
        { _uid: crypto.randomUUID(), min: 100, value: 1 },
        { _uid: crypto.randomUUID(), min: 250, value: 2 },
        { _uid: crypto.randomUUID(), min: 500, value: 3 },
      ],
    })
    suggestedTerms.push({
      type: "Tiered Volume Rebate",
      description: "Progressive rebate: 1% at 100 units, 2% at 250 units, 3% at 500+ units",
      rationale: "Tiered structures motivate increasing purchases. The facility always benefits from buying more, and each tier is profitable for the vendor at the corresponding volume.",
    })
    negotiationAdvice.push(
      "Concede on: A lower entry tier threshold if the facility has historically low volume — it builds trust and hooks them into the program."
    )
  }

  // ── Competitive context signals ───────────────────────────────
  let competitiveStrategy: string | null = null
  if (hasCompetitor) {
    competitiveStrategy = "A competitor is in the picture. Focus on total value of partnership (service, reliability, clinical support) rather than matching price point-for-point. If you must match pricing, do it through rebate structures that lock in volume rather than straight price reductions that erode your ASP."
    negotiationAdvice.push(
      "Push for: A head-to-head product evaluation or trial period rather than a straight price match — this leverages product quality advantages."
    )
    riskFactors.push("Competing offer present. Avoid a race-to-the-bottom on price — differentiate on service and total cost of ownership.")
  }

  // ── Urgency assessment ────────────────────────────────────────
  let urgencyAssessment: string | null = null
  if (hasUrgency) {
    urgencyAssessment = "The deal has time pressure. This can work in your favor — offer a limited-time signing bonus (e.g., additional 0.5% rebate for signing within 2 weeks) to create urgency while maintaining your standard pricing structure."
    negotiationAdvice.push(
      "Push for: Quick close by offering a time-limited signing incentive rather than permanent price concessions."
    )
    riskFactors.push("Urgency may be artificial negotiation pressure. Verify the timeline before making concessions.")
  }

  // ── Relationship context ──────────────────────────────────────
  if (hasRelationship) {
    negotiationAdvice.push(
      "Leverage the existing relationship — propose a loyalty tier or renewal bonus that rewards continued partnership."
    )
    suggestedTerms.push({
      type: "Loyalty Renewal Bonus",
      description: "0.5% additional rebate applied at contract renewal for continuous partners",
      rationale: "Rewarding long-term customers reduces churn risk and costs less than acquiring new business. This signals that the vendor values the relationship.",
    })
  }

  // ── Determine deal strength ───────────────────────────────────
  let strengthPoints = 0
  if (contractYears >= 2) strengthPoints += 2
  if (sharePercent >= 50) strengthPoints += 2
  if (hasRelationship) strengthPoints += 1
  if (hasExclusivity) strengthPoints += 2
  if (hasCompetitor) strengthPoints -= 1
  if (hasUrgency) strengthPoints -= 1
  const dealStrength: "strong" | "moderate" | "weak" =
    strengthPoints >= 4 ? "strong" : strengthPoints >= 1 ? "moderate" : "weak"

  const recommendedDiscount =
    dealStrength === "strong" ? "2-4% off list"
    : dealStrength === "moderate" ? "5-8% off list"
    : "8-12% off list (competitive situation)"

  // ── Apply terms to proposal ───────────────────────────────────
  if (generatedTerms.length > 0) {
    setNewProposal(prev => {
      const existingTypes = prev.terms.map(t => t.termType)
      const newTerms = generatedTerms.filter(t => !existingTypes.includes(t.termType))
      return {
        ...prev,
        terms: [...prev.terms, ...newTerms],
      }
    })
    toast.success(`Suggested ${generatedTerms.length} deal term(s) from your notes (rule-based keyword matching). Review below.`)
  } else {
    setNewProposal(prev => ({
      ...prev,
      terms: [...prev.terms, {
        id: `suggested-default-${Date.now()}`,
        termType: "spend_rebate" as const,
        name: "Standard Spend Rebate",
        targetType: "spend" as const,
        targetValue: prev.projectedSpend || 500000,
        rebatePercent: 2.5,
        rebateType: "percent" as const,
        tiers: [],
      }],
    }))
    suggestedTerms.push({
      type: "Standard Spend Rebate",
      description: "2.5% rebate on projected annual spend",
      rationale: "A standard spend rebate is a safe starting point. Add more detail to your notes (spend targets, market share goals, contract length) for more specific recommendations.",
    })
    toast.info("Added a standard spend rebate term. Add more details to your notes for specific suggestions.")
  }

  // ── Always add general advice if none was generated ───────────
  if (negotiationAdvice.length === 0) {
    negotiationAdvice.push(
      "Push for: Multi-year commitment in exchange for better rebate tiers.",
      "Concede on: Small administrative items (reporting frequency, payment terms) to build goodwill.",
      "Avoid: Upfront price reductions without volume commitment — use rebates to protect your ASP."
    )
  }
  if (riskFactors.length === 0) {
    riskFactors.push("No significant risk signals detected in the deal notes. Proceed with standard terms.")
  }

  return {
    dealStrength,
    recommendedDiscount,
    negotiationAdvice,
    suggestedTerms,
    riskFactors,
    competitiveStrategy,
    urgencyAssessment: urgencyAssessment ?? undefined,
  }
}
