/**
 * Shared types for the pricing-import actions.
 *
 * Lives outside the `"use server"` boundary so plain helpers
 * (e.g. lib/contracts/pricing-row-sanitize.ts) can import the shape
 * without pulling a server-action module into a client/util bundle.
 * `lib/actions/pricing-files.ts` re-exports `ContractPricingItem` so
 * existing `@/lib/actions/pricing-files` import sites keep working.
 */
export interface ContractPricingItem {
  vendorItemNo: string
  description?: string
  category?: string
  unitPrice: number
  listPrice?: number
  uom?: string
  effectiveDate?: string
  expirationDate?: string
  /** Charles iMessage 2026-04-20 N17 — per-SKU carve-out rate (fraction, 0.03 = 3%). */
  carveOutPercent?: number
}
