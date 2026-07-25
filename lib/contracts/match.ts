/**
 * Canonical COG → Contract match algorithm.
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

import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"

/** Match threshold: any |variancePercent| strictly above this is `price_variance`. */
export const PRICE_VARIANCE_THRESHOLD = 2 // percent

export type CogRecordForMatch = {
  facilityId: string
  vendorId: string | null
  vendorName: string | null
  vendorItemNo: string | null
  /**
   * Manufacturer / cross-vendor reference number. Stable across vendor
   * name + SKU variations within a group — the robust cross-vendor key.
   * Optional for back-compat. (Charles 2026-06-06.)
   */
  manufacturerNo?: string | null
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
  /**
   * Grouped (multi-vendor) contracts list participating vendors here in
   * addition to the primary `vendorId`. Matcher consumers register the
   * contract under each id so a COG row for any participating vendor
   * resolves to this contract via the vendorId+date cascade.
   */
  additionalVendorIds?: string[]
  status: "active" | "expiring" | "expired" | "draft" | "pending"
  effectiveDate: Date
  expirationDate: Date | null
  facilityIds: string[]
  pricingItems: ContractPricingItemForMatch[]
  /**
   * Union of cross-vendor reference numbers covered by this contract, from
   * each term's `referenceNumbers[]`. The matcher re-normalizes each entry
   * with `normalizeSku` at compare time, so the caller may pass raw or
   * pre-normalized values (recompute pre-normalizes; both are idempotent).
   * Used as the cross-vendor fallback match key when a per-vendor SKU
   * lookup misses (Charles 2026-06-06). Optional for back-compat.
   */
  referenceNumbers?: string[]
  /**
   * Optional — when omitted the matcher falls back to pre-W1.W
   * behavior (no category scoping). See W1.W bug cluster C4.
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
  // 2026-06-08 (Charles "I selected every category … not all the spend is
  // brought in. The category check must be off"): this gate previously
  // compared RAW category strings, so a COG row stored as "Joint replacement"
  // (vendor casing) failed to match the contract's selected "Joint
  // Replacement" and got tagged out_of_scope — under-counting eligible spend
  // AND inflating the "Pre-Match" total. Canonicalize BOTH sides (case /
  // separator / word-order / plural insensitive), mirroring the SKU path
  // (normalizeSku) and the already-fixed market-share card
  // (canonicalizeCategoryName in derived-metrics.ts).
  const covered = new Set<string>()
  for (const t of terms) {
    const scope = t.appliesTo ?? null
    if (scope !== "specific_category") return true
    for (const c of t.categories ?? []) {
      const key = canonicalizeCategoryName(c)
      if (key) covered.add(key)
    }
  }
  if (covered.size === 0) return true
  if (!cogCategory) return false
  return covered.has(canonicalizeCategoryName(cogCategory))
}

/** Build the on_contract / price_variance result for a matched pricing item. */
function priceResultFor(
  contract: ContractForMatch,
  item: ContractPricingItemForMatch,
  record: CogRecordForMatch,
): MatchResult {
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
  // Narrow to a local so the .filter() closure below keeps `string`
  // (control-flow narrowing of record.vendorId doesn't cross the closure).
  const recordVendorId: string = record.vendorId

  // 2. Active/expiring contracts for this vendor.
  //
  // #2 (Vick 2026-05-31): a grouped contract participates under its
  // primary `vendorId` AND every `additionalVendorIds` entry. Without
  // the additionalVendorIds leg, COG purchased by a group's secondary
  // vendor was never attributed to the contract — so group spend and
  // carve-out (which read matched COG) came back near-empty. The
  // contract's price-file ref number is then matched in step 5, so a
  // SKU bought by any group vendor resolves to the contract.
  const activeContracts = contracts.filter(
    (c) =>
      (c.vendorId === recordVendorId ||
        (c.additionalVendorIds ?? []).includes(recordVendorId)) &&
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

  // 5. Item lookup across candidate contracts.
  //    Primary key: vendorItemNo (per-vendor SKU, most precise — carries price).
  //    Fallback key: manufacturerNo matched against the contract's
  //    referenceNumbers (cross-vendor membership, no price). Charles 2026-06-06.
  // Normalize the SKU on the COG side so it matches the contract-side
  // normalization below. normalizeSku() returns "" for null/blank, which is
  // falsy — so the both-null guard and the `if (skuKey)` skip below behave
  // exactly as the old `?.toLowerCase() ?? null` did for empty SKUs.
  const skuKey = normalizeSku(record.vendorItemNo)
  // Charles 2026-06-06 — normalize the reference-number key with the SAME
  // helper as SKUs (normalizeSku: case + whitespace fold, preserves
  // hyphen/dot/underscore/slash). Previously this used a bare
  // `.toLowerCase()`, so formatting drift (trailing space, internal space)
  // dropped a ref that should have matched. Conservative on purpose:
  // "6-820-00" stays distinct from "682000". normalizeSku() returns "" for
  // null/blank — falsy, so the both-null guard below is preserved.
  const mfrKey = normalizeSku(record.manufacturerNo)

  if (!skuKey && !mfrKey) {
    return {
      status: "off_contract_item",
      reason:
        "record has no vendorItemNo or manufacturerNo to match against contract pricing",
    }
  }

  // Primary: SKU match. Normalize the contract-side SKU with the same
  // helper so formatting drift (trailing space, hyphen vs none, case)
  // doesn't drop the row to off_contract_item.
  if (skuKey) {
    for (const contract of byCategory) {
      const item = contract.pricingItems.find(
        (p) => normalizeSku(p.vendorItemNo) === skuKey,
      )
      if (item) return priceResultFor(contract, item, record)
    }
  }

  // Fallback: cross-vendor reference number (ContractTerm.referenceNumbers).
  // Membership-only — the contract covers this reference number but carries
  // no per-item contract price for it, so we record on_contract with no
  // price-variance claim (Charles 2026-06-06).
  if (mfrKey) {
    for (const contract of byCategory) {
      const covered = (contract.referenceNumbers ?? []).some(
        (rn) => normalizeSku(rn) === mfrKey,
      )
      if (covered) {
        return {
          status: "on_contract",
          contractId: contract.id,
          contractPrice: record.unitCost,
          savings: 0,
          matchedCategory: record.category ?? null,
        }
      }
    }
  }

  return {
    status: "off_contract_item",
    reason: "vendor and facility and date match, but item not on any contract",
  }
}
