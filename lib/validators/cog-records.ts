import { z } from "zod"

// ─── COG Record Input (for import) ──────────────────────────────

export const cogRecordInputSchema = z.object({
  vendorId: z.string().optional(),
  vendorName: z.string().optional(),
  inventoryNumber: z.string().min(1, "Inventory number is required"),
  inventoryDescription: z.string().min(1, "Description is required"),
  vendorItemNo: z.string().optional(),
  manufacturerNo: z.string().optional(),
  unitCost: z.number().min(0, "Unit cost must be positive"),
  extendedPrice: z.number().optional(),
  quantity: z.number().int().min(1),
  transactionDate: z.string().min(1, "Transaction date is required"),
  category: z.string().optional(),
})

export type COGRecordInput = z.infer<typeof cogRecordInputSchema>

// ─── Create COG Record (manual entry) ───────────────────────────

export const createCOGRecordSchema = cogRecordInputSchema.extend({
  facilityId: z.string().min(1),
})

export type CreateCOGRecordInput = z.infer<typeof createCOGRecordSchema>

// ─── COG Filters ────────────────────────────────────────────────

export const cogFiltersSchema = z.object({
  facilityId: z.string().optional(),
  search: z.string().optional(),
  vendorId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export type COGFilters = z.infer<typeof cogFiltersSchema>

// ─── Bulk Import Schema ─────────────────────────────────────────

export const bulkImportSchema = z.object({
  facilityId: z.string().min(1),
  records: z.array(cogRecordInputSchema).min(1),
  duplicateStrategy: z.enum(["skip", "overwrite", "keep_both"]),
  /** S3 key of the uploaded source CSV file (optional). */
  sourceFileKey: z.string().optional(),
})

export type BulkImportInput = z.infer<typeof bulkImportSchema>
