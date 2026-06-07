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

import { canonicalizeCategoryName } from "./category-canonical"

/**
 * Mapping-key normalization for confirmed `CategoryMapping` lookups.
 * MUST stay identical to `normalizeCategoryKey` in
 * `lib/categories/resolve.ts` (the import path's Pass-0 key) so a user's
 * confirmed remap collapses the same way in market share as on import.
 * Inlined (not imported) to keep this helper DB-free — `resolve.ts`
 * imports prisma. Callers build the map via `loadConfirmedCategoryMap`,
 * which keys by the same function.
 */
const normalizeCategoryKey = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, " ")

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
  /**
   * Vendor(s) whose share is being computed. A single id is the common
   * case (one vendor's share); an array is a GROUPED contract (#2, Vick
   * 2026-05-31) — the numerator sums spend across every participating
   * vendor while the denominator stays the full category market. A
   * single-element array is identical to passing the string.
   */
  vendorId: string | string[]
  /** Optional category → commitment% overlay. */
  commitmentByCategory?: Map<string, number>
  /**
   * Confirmed `CategoryMapping` rules (Charles 2026-06-07): keyed by
   * `normalizeCategoryKey(cogCategory)` → mapped target category name.
   * Applied to a row's effective category BEFORE canonical grouping, so a
   * user's explicit remap (e.g. "Ortho-Upper Extremity" → "Ortho-Extremity"
   * via the Map Categories dialog) collapses the source into its target for
   * BOTH the numerator (vendor spend) and the denominator (category total).
   * Build it from `loadConfirmedCategoryMap` so market share and import
   * agree. When omitted, behavior is unchanged (string-canonical grouping).
   */
  confirmedCategoryMap?: Map<string, string>
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
  confirmedCategoryMap?: Map<string, string>,
): string | null {
  const raw = row.category
    ? row.category
    : row.contractId
      ? (contractCategoryMap.get(row.contractId) ?? null)
      : null
  if (raw == null) return null
  // Apply a confirmed remap FIRST (source → target) so the mapped target
  // is what canonical grouping later buckets on. Same key the import path
  // uses (normalizeCategoryKey). Falls through to `raw` when unmapped.
  if (confirmedCategoryMap) {
    const mapped = confirmedCategoryMap.get(normalizeCategoryKey(raw))
    if (mapped) return mapped
  }
  return raw
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
  const {
    rows,
    contractCategoryMap,
    vendorId,
    commitmentByCategory,
    confirmedCategoryMap,
  } = input
  // Normalize to a set so grouped contracts (array) and the common
  // single-vendor case share one code path.
  const vendorIdSet = new Set(Array.isArray(vendorId) ? vendorId : [vendorId])

  let totalVendorSpend = 0
  let uncategorizedSpend = 0

  type Bucket = { total: number; byVendor: Map<string, number>; displayName: string }
  // Bug 2026-05-20 (Vick): bucket by CANONICAL category key so variants
  // like "Ortho Joint" / "Joint Ortho" / "Ortho-Joint" collapse into
  // one market-share row. The first display name we see for a given
  // canonical wins the rendered label.
  const byCategory = new Map<string, Bucket>()

  for (const row of rows) {
    const amount = toAmount(row.extendedPrice)
    if (amount <= 0) continue

    const isVendor = row.vendorId != null && vendorIdSet.has(row.vendorId)
    const cat = effectiveCategoryOf(row, contractCategoryMap, confirmedCategoryMap)

    if (isVendor) {
      totalVendorSpend += amount
      if (!cat) uncategorizedSpend += amount
    }

    if (!cat) continue
    const key = canonicalizeCategoryName(cat)
    if (!key) continue

    const bucket = byCategory.get(key) ?? {
      total: 0,
      byVendor: new Map<string, number>(),
      displayName: cat,
    }
    bucket.total += amount
    if (row.vendorId) {
      bucket.byVendor.set(
        row.vendorId,
        (bucket.byVendor.get(row.vendorId) ?? 0) + amount,
      )
    }
    byCategory.set(key, bucket)
  }

  const result: MarketShareRow[] = []
  for (const [, bucket] of byCategory.entries()) {
    // Numerator = combined spend of every vendor in the set (the group).
    let vendorSpend = 0
    for (const [vid, amt] of bucket.byVendor) {
      if (vendorIdSet.has(vid)) vendorSpend += amt
    }
    if (vendorSpend <= 0) continue
    result.push({
      category: bucket.displayName,
      vendorSpend,
      categoryTotal: bucket.total,
      sharePct: bucket.total > 0 ? (vendorSpend / bucket.total) * 100 : 0,
      competingVendors: bucket.byVendor.size,
      commitmentPct:
        commitmentByCategory?.get(bucket.displayName) ??
        commitmentByCategory?.get(canonicalizeCategoryName(bucket.displayName)) ??
        null,
    })
  }

  result.sort((a, b) => b.categoryTotal - a.categoryTotal)
  return { rows: result, uncategorizedSpend, totalVendorSpend }
}
