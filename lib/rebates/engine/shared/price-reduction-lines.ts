/**
 * Shared utility — per-line price-reduction breakdown.
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.4
 *
 * ─── [A7] Per-line effectiveUnitPrice (no single aggregate) ──────
 *
 * Earlier designs collapsed "effective unit price" into a single scalar
 * on a price-reduction result. That number is meaningless when the
 * underlying purchases span MIXED original unit prices (e.g. one SKU at
 * $100 and another at $150) — a single "effective $90" cannot represent
 * both. [A7] fixes this by emitting a `PriceReductionLineResult` per
 * purchase: each line carries its own `originalUnitPrice`,
 * `effectiveUnitPrice`, and `totalLineReduction`. The engine's overall
 * `priceReductionValue` is the sum across lines.
 *
 * Semantics:
 *   - If `tier.reducedPrice` is set → effectiveUnitPrice = reducedPrice
 *     (absolute; used as-is even if it exceeds originalUnitPrice — the
 *     caller / upstream contract logic is responsible for sane tier
 *     configuration).
 *   - Else if `tier.priceReductionPercent` is set → effectiveUnitPrice =
 *     originalUnitPrice × (1 - priceReductionPercent).
 *   - Else → effectiveUnitPrice = originalUnitPrice, totalLineReduction = 0
 *     (signals a misconfigured tier; the caller surfaces a warning).
 */
import type {
  PriceReductionLineResult,
  PurchaseRecord,
  RebateTier,
} from "../types"

export function computePriceReductionLines(
  purchases: PurchaseRecord[],
  tier: RebateTier,
): PriceReductionLineResult[] {
  return purchases.map((purchase) => {
    const originalUnitPrice = purchase.unitPrice
    let effectiveUnitPrice = originalUnitPrice

    if (tier.reducedPrice != null) {
      // Absolute reduced price — used as-is even if higher than the
      // original. Tier config is the source of truth.
      effectiveUnitPrice = tier.reducedPrice
    } else if (tier.priceReductionPercent != null) {
      // Fractional reduction: 0.10 = 10% off.
      effectiveUnitPrice = originalUnitPrice * (1 - tier.priceReductionPercent)
    }
    // else: no reduction fields — leave effectiveUnitPrice = original.

    const totalLineReduction =
      (originalUnitPrice - effectiveUnitPrice) * purchase.quantity

    return {
      referenceNumber: purchase.referenceNumber,
      purchaseDate: purchase.purchaseDate,
      quantity: purchase.quantity,
      originalUnitPrice,
      effectiveUnitPrice,
      totalLineReduction,
    }
  })
}
