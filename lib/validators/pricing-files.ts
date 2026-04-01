import { z } from "zod"

// ─── Pricing File Input (for import) ────────────────────────────

export const pricingFileInputSchema = z.object({
  vendorItemNo: z.string().min(1, "Vendor item number is required"),
  manufacturerNo: z.string().optional(),
  productDescription: z.string().min(1, "Description is required"),
  listPrice: z.number().optional(),
  contractPrice: z.number().optional(),
  effectiveDate: z.string().min(1, "Effective date is required"),
  expirationDate: z.string().optional(),
  category: z.string().optional(),
  uom: z.string().default("EA"),
  carveOut: z.boolean().optional(),
})

export type PricingFileInput = z.infer<typeof pricingFileInputSchema>

// ─── Pricing Filters ────────────────────────────────────────────

export const pricingFiltersSchema = z.object({
  facilityId: z.string().optional(),
  vendorId: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export type PricingFilters = z.infer<typeof pricingFiltersSchema>

// ─── Bulk Import Pricing ────────────────────────────────────────

export const bulkImportPricingSchema = z.object({
  vendorId: z.string().min(1),
  facilityId: z.string().min(1),
  records: z.array(pricingFileInputSchema).min(1),
})

export type BulkImportPricingInput = z.infer<typeof bulkImportPricingSchema>
