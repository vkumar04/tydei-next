import { z } from "zod"
import { POStatusSchema } from "@/lib/validators"

export const poLineItemSchema = z.object({
  sku: z.string().optional(),
  inventoryDescription: z.string().min(1, "Description is required"),
  vendorItemNo: z.string().optional(),
  manufacturerNo: z.string().optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  unitPrice: z.number().min(0, "Price must be non-negative"),
  uom: z.string().default("EA"),
  isOffContract: z.boolean().default(false),
  contractId: z.string().optional(),
})

export type POLineItemInput = z.infer<typeof poLineItemSchema>

export const createPOSchema = z.object({
  facilityId: z.string().min(1),
  vendorId: z.string().min(1, "Vendor is required"),
  contractId: z.string().optional(),
  orderDate: z.string().min(1, "Order date is required"),
  lineItems: z.array(poLineItemSchema).min(1, "At least one line item is required"),
})

export type CreatePOInput = z.infer<typeof createPOSchema>

export const poFiltersSchema = z.object({
  facilityId: z.string().min(1),
  vendorId: z.string().optional(),
  status: POStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export type POFilters = z.infer<typeof poFiltersSchema>
