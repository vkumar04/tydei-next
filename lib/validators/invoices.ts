import { z } from "zod"

export const invoiceLineItemSchema = z.object({
  inventoryDescription: z.string().min(1),
  vendorItemNo: z.string().optional(),
  invoicePrice: z.number().min(0),
  invoiceQuantity: z.number().int().min(1),
})

export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>

export const importInvoiceSchema = z.object({
  facilityId: z.string().min(1),
  vendorId: z.string().min(1, "Vendor is required"),
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  purchaseOrderId: z.string().optional(),
  /**
   * PO number to link — resolved server-side via facility-scoped lookup.
   * Used by the manual-entry dialog (which collects a number, not an id).
   */
  poNumber: z.string().optional(),
  // Header-level adjustments. totalInvoiceCost is computed server-side as
  // lineSum + taxAmount + shippingAmount − discountAmount.
  taxAmount: z.number().min(0).optional(),
  shippingAmount: z.number().min(0).optional(),
  discountAmount: z.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(invoiceLineItemSchema).min(1, "At least one line item is required"),
})

export type ImportInvoiceInput = z.infer<typeof importInvoiceSchema>

export const invoiceFiltersSchema = z.object({
  facilityId: z.string().optional(),
  vendorId: z.string().optional(),
  status: z.string().optional(),
  page: z.number().int().min(1).optional(),
  // M8: 200 cap — both invoice clients fetch a single page and slice
  // client-side; real server pagination is future work.
  pageSize: z.number().int().min(1).max(200).optional(),
})

export type InvoiceFilters = z.infer<typeof invoiceFiltersSchema>
