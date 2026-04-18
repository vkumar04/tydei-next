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
}

export type ContractPricingItemForMatch = {
  vendorItemNo: string
  unitPrice: number
  listPrice: number | null
}

export type ContractForMatch = {
  id: string
  vendorId: string
  status: "active" | "expiring" | "expired" | "draft" | "pending"
  effectiveDate: Date
  expirationDate: Date | null
  facilityIds: string[]
  pricingItems: ContractPricingItemForMatch[]
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
    }
  | {
      status: "price_variance"
      contractId: string
      contractPrice: number
      variancePercent: number
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

  // 5. Item lookup across candidate contracts
  const itemNoLower = record.vendorItemNo?.toLowerCase() ?? null
  if (!itemNoLower) {
    return {
      status: "off_contract_item",
      reason: "record has no vendorItemNo to match against contract pricing",
    }
  }

  for (const contract of byDate) {
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
    }
  }

  return {
    status: "off_contract_item",
    reason: "vendor and facility and date match, but item not on any contract",
  }
}
