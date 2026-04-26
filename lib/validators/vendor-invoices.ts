import { z } from "zod"

/**
 * Vendor-side invoice submission. Lives in lib/validators/ rather
 * than alongside the action because "use server" files only allow
 * async exports — zod schemas are sync.
 */
export const submitVendorInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  /** Facility id the vendor is invoicing. Server verifies relationship. */
  facilityId: z.string().min(1, "Facility is required"),
  /** Total invoice amount in dollars. */
  totalAmount: z.number().positive("Total amount must be positive"),
  /** Invoice date — ISO date string. Defaults to today server-side. */
  invoiceDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
})

export type SubmitVendorInvoiceInput = z.infer<typeof submitVendorInvoiceSchema>
