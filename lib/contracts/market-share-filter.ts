// lib/contracts/market-share-filter.ts
/**
 * Canonical per-category market-share helper.
 *
 * Used by every surface that renders "vendor share of category X at this
 * facility" — facility-scoped contract detail card, vendor-session
 * dashboard widget. Both code paths previously implemented the same
 * `effectiveCategory` fallback + bucket math inline; the vendor-session
 * version had a real drift bug where the fallback applied to the
 * numerator but not to the per-category denominator.
 *
 * Rule: the *only* way to compute per-category market share is to call
 * this helper. Server actions own Prisma fetching + auth + the
 * commitment overlay; this helper owns the math.
 *
 * See: `docs/superpowers/specs/2026-04-26-v0-parity-engines-design.md`
 * Bucket A1.
 */

export interface MarketShareCogRow {
  vendorId: string | null
  category: string | null
  extendedPrice: number | string | { toString(): string } | null
  contractId: string | null
}

export interface MarketShareRow {
  category: string
  vendorSpend: number
  categoryTotal: number
  /** vendorSpend / categoryTotal × 100. 0–100. */
  sharePct: number
  /** Number of distinct vendors with positive spend in this category. */
  competingVendors: number
  /** Optional commitment overlay; null when no overlay supplied. */
  commitmentPct: number | null
}

export interface MarketShareResult {
  rows: MarketShareRow[]
  /** Vendor spend (in window) where neither COG.category nor the
   *  matched-contract productCategory could resolve a category. */
  uncategorizedSpend: number
  /** Vendor's total spend in the input window — categorized + un-. */
  totalVendorSpend: number
}

export interface ComputeMarketShareInput {
  /** Already-windowed COG rows for the facility (or vendor session). */
  rows: MarketShareCogRow[]
  /** contractId → productCategory.name lookup. Pass an empty Map to
   *  disable the fallback. */
  contractCategoryMap: Map<string, string | null>
  /** Vendor whose share is being computed. */
  vendorId: string
  /** Optional category → commitment% overlay. */
  commitmentByCategory?: Map<string, number>
}

/**
 * Resolve a COG row's effective category: explicit COG.category first,
 * then the matched-contract productCategory.name. Exported for tests
 * and for any caller that needs the same resolution semantics outside
 * of share computation.
 */
export function effectiveCategoryOf(
  row: MarketShareCogRow,
  contractCategoryMap: Map<string, string | null>,
): string | null {
  if (row.category) return row.category
  if (row.contractId) return contractCategoryMap.get(row.contractId) ?? null
  return null
}

function toAmount(price: MarketShareCogRow["extendedPrice"]): number {
  if (price == null) return 0
  if (typeof price === "number") return price
  if (typeof price === "string") return Number(price)
  return Number(price.toString())
}

export function computeCategoryMarketShare(
  input: ComputeMarketShareInput,
): MarketShareResult {
  const { rows, contractCategoryMap, vendorId, commitmentByCategory } = input

  let totalVendorSpend = 0
  let uncategorizedSpend = 0

  type Bucket = { total: number; byVendor: Map<string, number> }
  const byCategory = new Map<string, Bucket>()

  for (const row of rows) {
    const amount = toAmount(row.extendedPrice)
    if (amount <= 0) continue

    const isVendor = row.vendorId === vendorId
    const cat = effectiveCategoryOf(row, contractCategoryMap)

    if (isVendor) {
      totalVendorSpend += amount
      if (!cat) uncategorizedSpend += amount
    }

    if (!cat) continue

    const bucket = byCategory.get(cat) ?? {
      total: 0,
      byVendor: new Map<string, number>(),
    }
    bucket.total += amount
    if (row.vendorId) {
      bucket.byVendor.set(
        row.vendorId,
        (bucket.byVendor.get(row.vendorId) ?? 0) + amount,
      )
    }
    byCategory.set(cat, bucket)
  }

  const result: MarketShareRow[] = []
  for (const [category, bucket] of byCategory.entries()) {
    const vendorSpend = bucket.byVendor.get(vendorId) ?? 0
    if (vendorSpend <= 0) continue
    result.push({
      category,
      vendorSpend,
      categoryTotal: bucket.total,
      sharePct: bucket.total > 0 ? (vendorSpend / bucket.total) * 100 : 0,
      competingVendors: bucket.byVendor.size,
      commitmentPct: commitmentByCategory?.get(category) ?? null,
    })
  }

  result.sort((a, b) => b.categoryTotal - a.categoryTotal)
  return { rows: result, uncategorizedSpend, totalVendorSpend }
}
