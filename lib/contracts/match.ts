/**
 * Canonical COG → Contract match algorithm.
 *
 * Per docs/superpowers/specs/2026-04-18-platform-data-model-reconciliation.md §4.9.
 *
 * ─── Sign convention (§4.11, LOCKED IN) ─────────────────────────────
 *
 *   savings > 0            → facility paid LESS than list (WIN)
 *   variancePercent > 0    → facility paid MORE than contract (BAD, flag)
 *   variancePercent === 0  → on contract exactly
 *   variancePercent < 0    → paid BELOW contract (rare; credit-memo correction)
 *
 *   savings = (listPrice - unitPrice) × quantity
 *   variancePercent = ((actual - contract) / contract) × 100
 *
 * This module is pure. No DB calls. Callers load contracts + pass them in.
 */

/** Match threshold: any |variancePercent| strictly above this is `price_variance`. */
export const PRICE_VARIANCE_THRESHOLD = 2 // percent

export type CogRecordForMatch = {
  facilityId: string
  vendorId: string | null
  vendorName: string | null
  vendorItemNo: string | null
  unitCost: number
  quantity: number
  transactionDate: Date
  /** COG row's category — used for category-scope matching (W1.W-C4). Optional for backward compat. */
  category?: string | null
}

export type ContractPricingItemForMatch = {
  vendorItemNo: string
  unitPrice: number
  listPrice: number | null
  /**
   * Charles iMessage 2026-04-20 N15 — category on the pricing-file row.
   * When a COG row matches, recompute-cog fills the COG row's category
   * from this field if the COG row's own category is empty.
   */
  category?: string | null
}

/**
 * Category-scope info from the contract's terms (Charles W1.W-C4).
 *
 * When a term's `appliesTo === "specific_category"`, only COG rows whose
 * `category` matches one of `categories` are on-contract under that
 * term. We aggregate across all terms: if ANY term is broadly-scoped
 * (`all_products` or scope unset) the contract covers every category;
 * otherwise the contract's covered-category set is the union of all
 * specific-category term lists.
 */
export interface ContractTermScopeForMatch {
  appliesTo?: string | null
  categories?: string[]
}

export type ContractForMatch = {
  id: string
  vendorId: string
  status: "active" | "expiring" | "expired" | "draft" | "pending"
  effectiveDate: Date
  expirationDate: Date | null
  facilityIds: string[]
  pricingItems: ContractPricingItemForMatch[]
  /**
   * Optional — when omitted the matcher falls back to pre-W1.W
   * behavior (no category scoping). See
   * docs/superpowers/plans/2026-04-20-charles-w1w-bug-cluster.md C4.
   */
  terms?: ContractTermScopeForMatch[]
}

export type MatchResult =
  | { status: "unknown_vendor" }
  | { status: "off_contract_item"; reason: string }
  | { status: "out_of_scope"; reason: string }
  | {
      status: "on_contract"
      contractId: string
      contractPrice: number
      savings: number
      /** Charles iMessage 2026-04-20 N15 — category from the matched pricing row. */
      matchedCategory?: string | null
    }
  | {
      status: "price_variance"
      contractId: string
      contractPrice: number
      variancePercent: number
      matchedCategory?: string | null
    }

/**
 * Returns true when the COG row's category is covered by the contract's
 * terms. When the contract has no terms, or any term is
 * broadly-scoped, returns true (no narrowing). When every term is
 * `specific_category`, requires `cogCategory` to be in the union.
 * A COG row with a null category is treated as out-of-scope for
 * category-locked contracts — we can't prove coverage without a name.
 */
export function cogCategoryCoveredByContract(
  cogCategory: string | null,
  terms: readonly ContractTermScopeForMatch[] | undefined,
): boolean {
  if (!terms || terms.length === 0) return true
  const covered = new Set<string>()
  for (const t of terms) {
    const scope = t.appliesTo ?? null
    if (scope !== "specific_category") return true
    for (const c of t.categories ?? []) covered.add(c)
  }
  if (covered.size === 0) return true
  if (!cogCategory) return false
  return covered.has(cogCategory)
}

/**
 * Returns a MatchResult describing how a COG record relates to a set of
 * candidate contracts. See file header for algorithm + sign convention.
 */
export function matchCOGRecordToContract(
  record: CogRecordForMatch,
  contracts: ContractForMatch[],
): MatchResult {
  // 1. Vendor resolution
  if (!record.vendorId) {
    return { status: "unknown_vendor" }
  }

  // 2. Active/expiring contracts for this vendor
  const activeContracts = contracts.filter(
    (c) =>
      c.vendorId === record.vendorId &&
      (c.status === "active" || c.status === "expiring"),
  )
  if (activeContracts.length === 0) {
    return { status: "off_contract_item", reason: "no active contract for vendor" }
  }

  // 3. Facility scope
  const inScope = activeContracts.filter((c) =>
    c.facilityIds.includes(record.facilityId),
  )
  if (inScope.length === 0) {
    return { status: "out_of_scope", reason: "no contract covers this facility" }
  }

  // 4. Date scope
  const byDate = inScope.filter((c) => {
    const recordMs = record.transactionDate.getTime()
    if (recordMs < c.effectiveDate.getTime()) return false
    if (c.expirationDate && recordMs > c.expirationDate.getTime()) return false
    return true
  })
  if (byDate.length === 0) {
    return { status: "out_of_scope", reason: "no contract covers this date" }
  }

  // 4b. Category scope (Charles W1.W-C4): if a contract's terms
  //     restrict it to specific categories, only COG rows whose
  //     category is in that set belong on the contract. Contracts
  //     with no terms (or any broadly-scoped term) skip this filter.
  const byCategory = byDate.filter((c) =>
    cogCategoryCoveredByContract(record.category ?? null, c.terms),
  )
  if (byCategory.length === 0) {
    return {
      status: "out_of_scope",
      reason: "no contract covers this COG row's category",
    }
  }

  // 5. Item lookup across candidate contracts
  const itemNoLower = record.vendorItemNo?.toLowerCase() ?? null
  if (!itemNoLower) {
    return {
      status: "off_contract_item",
      reason: "record has no vendorItemNo to match against contract pricing",
    }
  }

  for (const contract of byCategory) {
    const item = contract.pricingItems.find(
      (p) => p.vendorItemNo.toLowerCase() === itemNoLower,
    )
    if (!item) continue

    // Sign convention: variancePercent > 0 means facility OVERPAID vs contract.
    const variancePercent =
      item.unitPrice === 0
        ? 0
        : ((record.unitCost - item.unitPrice) / item.unitPrice) * 100

    if (Math.abs(variancePercent) > PRICE_VARIANCE_THRESHOLD) {
      return {
        status: "price_variance",
        contractId: contract.id,
        contractPrice: item.unitPrice,
        variancePercent,
        matchedCategory: item.category ?? null,
      }
    }

    // Savings convention: positive = facility paid less than list.
    const savings =
      item.listPrice === null
        ? 0
        : (item.listPrice - item.unitPrice) * record.quantity

    return {
      status: "on_contract",
      contractId: contract.id,
      contractPrice: item.unitPrice,
      savings,
      matchedCategory: item.category ?? null,
    }
  }

  return {
    status: "off_contract_item",
    reason: "vendor and facility and date match, but item not on any contract",
  }
}
