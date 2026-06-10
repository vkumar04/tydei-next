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
  // H5 (2026-06-09 audit): "Submit PO" sends directly to the vendor
  // (status "sent"); "Save as Draft" keeps status "draft". Previously the
  // form's asDraft flag was silently ignored and everything became a draft.
  submit: z.boolean().default(false),
})

export type CreatePOInput = z.input<typeof createPOSchema>

// ─── Vendor-side create (M8) ────────────────────────────────────
// Mirrors poLineItemSchema; previously the vendor action took an unvalidated
// interface, so quantity 0 / negative prices / empty descriptions and an
// unparseable orderDate all passed straight to Prisma.

export const vendorPOLineItemSchema = z.object({
  sku: z.string().optional(),
  inventoryDescription: z.string().min(1, "Description is required"),
  vendorItemNo: z.string().optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  unitPrice: z.number().min(0, "Price must be non-negative"),
  uom: z.string().default("EA"),
  isOffContract: z.boolean().default(false),
})

export const createVendorPOSchema = z.object({
  facilityId: z.string().min(1, "Facility is required"),
  contractId: z.string().optional(),
  orderDate: z
    .string()
    .min(1, "Order date is required")
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid order date"),
  lineItems: z
    .array(vendorPOLineItemSchema)
    .min(1, "At least one line item is required"),
})

export type CreateVendorPOInput = z.input<typeof createVendorPOSchema>

export const poFiltersSchema = z.object({
  facilityId: z.string().min(1),
  vendorId: z.string().optional(),
  status: POStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export type POFilters = z.infer<typeof poFiltersSchema>
