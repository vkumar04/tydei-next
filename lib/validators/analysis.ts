import { z } from "zod"

// ─── Depreciation Input ────────────────────────────────────────

export const depreciationInputSchema = z.object({
  contractId: z.string().optional(),
  assetCost: z.number().min(0, "Asset cost must be positive"),
  recoveryPeriod: z.union([
    z.literal(5),
    z.literal(7),
    z.literal(10),
    z.literal(15),
  ]),
  convention: z.enum(["half_year", "mid_quarter"]),
})

export type DepreciationInput = z.infer<typeof depreciationInputSchema>

// ─── Price Projection Input ────────────────────────────────────

export const priceProjectionInputSchema = z.object({
  facilityId: z.string(),
  vendorId: z.string().optional(),
  categoryId: z.string().optional(),
  periods: z.number().int().min(1).max(60),
})

export type PriceProjectionInput = z.infer<typeof priceProjectionInputSchema>

// ─── Spend Trend Input ─────────────────────────────────────────

export const spendTrendInputSchema = z.object({
  facilityId: z.string(),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
})

export type SpendTrendInput = z.infer<typeof spendTrendInputSchema>

// ─── Proposed Pricing Item ─────────────────────────────────────

export const proposedPricingItemSchema = z.object({
  vendorItemNo: z.string().min(1),
  description: z.string().optional(),
  proposedPrice: z.number().min(0),
  currentPrice: z.number().min(0).optional(),
  quantity: z.number().int().min(1).optional(),
})

export type ProposedPricingItem = z.infer<typeof proposedPricingItemSchema>
