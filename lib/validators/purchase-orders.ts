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
  // Bill-only traceability (2026-06-10): previously collected in the form's
  // Lot #/Serial # inputs and stripped on submit.
  lotNumber: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(100).optional(),
})

export type POLineItemInput = z.infer<typeof poLineItemSchema>

export const createPOSchema = z.object({
  facilityId: z.string().min(1),
  vendorId: z.string().min(1, "Vendor is required"),
  contractId: z.string().optional(),
  orderDate: z.string().min(1, "Order date is required"),
  // Bill-only PO context (2026-06-10): the form collected all of these and
  // silently discarded them. ISO date string, parsed like orderDate.
  // patientMrn/patientInitials/procedureDate are PHI-adjacent — persisted
  // for the facility side only; vendor reads exclude them.
  procedureDate: z
    .string()
    .refine(
      (s) => !Number.isNaN(new Date(s).getTime()),
      "Invalid procedure date",
    )
    .optional(),
  patientMrn: z.string().trim().max(64).optional(),
  patientInitials: z.string().trim().max(10).optional(),
  billToAddress: z.string().trim().max(500).optional(),
  paymentTerms: z.string().trim().max(50).optional(),
  departmentCode: z.string().trim().max(50).optional(),
  glCode: z.string().trim().max(50).optional(),
  specialInstructions: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
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
