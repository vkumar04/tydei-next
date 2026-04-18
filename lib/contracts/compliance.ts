/**
 * Purchase-level compliance + contract-level compliance rate +
 * market-share commitment tracking.
 *
 * Spec section 5 of contract-calculations.md. Violation taxonomy:
 * - off_contract: purchase has no active contract for the vendor.
 * - expired_contract: purchase after contract expiration.
 * - unapproved_item: SKU not in contract's approved list.
 * - price_variance: unit price > contract price by more than the
 *   tolerance (default 5%). Undercharges are not violations.
 *
 * Pure functions — callers pre-load the purchases + contracts.
 */

export type ComplianceViolation =
  | "off_contract"
  | "expired_contract"
  | "unapproved_item"
  | "price_variance"

export interface CompliancePurchase {
  vendorId: string
  vendorItemNo: string
  unitPrice: number
  purchaseDate: Date
}

export interface ComplianceContract {
  id: string
  vendorId: string
  effectiveDate: Date
  expirationDate: Date
  /** SKUs the contract authorizes. Undefined/empty => any SKU allowed. */
  approvedItems?: Set<string>
  /** Contract unit prices keyed by vendorItemNo. */
  priceByItem: Map<string, number>
}

export interface PurchaseComplianceResult {
  compliant: boolean
  reasons: ComplianceViolation[]
}

export interface ComplianceRateResult {
  totalPurchases: number
  compliantPurchases: number
  /** Null when no purchases (no denominator). */
  compliancePercent: number | null
  violationCounts: Record<ComplianceViolation, number>
}

// Tolerance for price-variance detection (fraction). 5% default matches
// spec section 5.
const PRICE_VARIANCE_TOLERANCE = 0.05

function emptyViolationCounts(): Record<ComplianceViolation, number> {
  return {
    off_contract: 0,
    expired_contract: 0,
    unapproved_item: 0,
    price_variance: 0,
  }
}

export function evaluatePurchaseCompliance(
  purchase: CompliancePurchase,
  activeContracts: ComplianceContract[],
  asOf: Date = new Date(),
): PurchaseComplianceResult {
  const reasons: ComplianceViolation[] = []

  // Find a contract with the purchase's vendor.
  const candidates = activeContracts.filter((c) => c.vendorId === purchase.vendorId)
  if (candidates.length === 0) {
    return { compliant: false, reasons: ["off_contract"] }
  }

  // Among candidate contracts, find one whose date range covers this
  // purchase. If any candidate covers it, prefer that; otherwise flag
  // expired_contract.
  const dateValid = candidates.filter(
    (c) =>
      purchase.purchaseDate >= c.effectiveDate &&
      purchase.purchaseDate <= c.expirationDate,
  )
  if (dateValid.length === 0) {
    // If any candidate is still active as of "asOf" but doesn't cover this
    // specific purchase date, that's still an expired/out-of-window buy.
    reasons.push("expired_contract")
    return { compliant: false, reasons }
  }

  // Use the first date-valid contract for item-level checks. Multiple
  // contracts could theoretically apply — spec doesn't require scoring
  // against the "best" one, just that one valid contract covers the buy.
  const contract = dateValid[0]

  // Item approval check.
  if (contract.approvedItems && contract.approvedItems.size > 0) {
    if (!contract.approvedItems.has(purchase.vendorItemNo)) {
      reasons.push("unapproved_item")
    }
  }

  // Price variance check. Only flag when the purchase price is ABOVE
  // contract price by more than tolerance (undercharges aren't a buyer
  // problem).
  const contractPrice = contract.priceByItem.get(purchase.vendorItemNo)
  if (contractPrice !== undefined && contractPrice > 0) {
    const variance = (purchase.unitPrice - contractPrice) / contractPrice
    if (variance > PRICE_VARIANCE_TOLERANCE) {
      reasons.push("price_variance")
    }
  }

  return {
    compliant: reasons.length === 0,
    reasons,
  }
}

export function calculateComplianceRate(
  purchases: CompliancePurchase[],
  activeContracts: ComplianceContract[],
  asOf: Date = new Date(),
): ComplianceRateResult {
  if (purchases.length === 0) {
    return {
      totalPurchases: 0,
      compliantPurchases: 0,
      compliancePercent: null,
      violationCounts: emptyViolationCounts(),
    }
  }

  const counts = emptyViolationCounts()
  let compliant = 0

  for (const purchase of purchases) {
    const result = evaluatePurchaseCompliance(purchase, activeContracts, asOf)
    if (result.compliant) compliant++
    for (const reason of result.reasons) counts[reason]++
  }

  return {
    totalPurchases: purchases.length,
    compliantPurchases: compliant,
    compliancePercent: (compliant / purchases.length) * 100,
    violationCounts: counts,
  }
}

// ─── Market share ───────────────────────────────────────────────────

export interface MarketShareResult {
  currentMarketShare: number
  /** null when no commitment is configured. */
  commitmentMet: boolean | null
  /** Percentage-point delta (current − commitment). Negative = gap. null when no commitment. */
  gap: number | null
}

export function calculateMarketShare(
  vendorSpend: number,
  categoryTotalSpend: number,
  commitmentPercent: number | null | undefined,
): MarketShareResult {
  const currentMarketShare =
    categoryTotalSpend > 0 ? (vendorSpend / categoryTotalSpend) * 100 : 0

  if (commitmentPercent === null || commitmentPercent === undefined) {
    return {
      currentMarketShare,
      commitmentMet: null,
      gap: null,
    }
  }

  const gap = currentMarketShare - commitmentPercent
  return {
    currentMarketShare,
    commitmentMet: gap >= 0,
    gap,
  }
}
