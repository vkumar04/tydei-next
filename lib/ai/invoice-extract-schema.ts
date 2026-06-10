import { z } from "zod"

/**
 * Schema for AI invoice extraction (OCR path of the invoice import
 * dialog). Shared by `/api/ai/extract-invoice` (server) and
 * `invoice-import-dialog.tsx` (client preview typing).
 *
 * Every field is nullish — scanned invoices are messy and a partial
 * extract the user can fix in the preview beats a hard Zod failure.
 */
export const extractedInvoiceLineItemSchema = z.object({
  /** Vendor catalog / item number (SKU) as printed on the invoice. */
  vendorItemNo: z.string().nullish(),
  description: z.string().nullish(),
  quantity: z.number().nullish(),
  unitPrice: z.number().nullish(),
})

export const extractedInvoiceSchema = z.object({
  invoiceNumber: z.string().nullish(),
  vendorName: z.string().nullish(),
  /** ISO yyyy-mm-dd preferred; the prompt asks for it explicitly. */
  invoiceDate: z.string().nullish(),
  /** Purchase-order number referenced on the invoice, if any. */
  poNumber: z.string().nullish(),
  lineItems: z.array(extractedInvoiceLineItemSchema).default([]),
  /** Header-level dollar amounts (NOT percentages). */
  tax: z.number().nullish(),
  shipping: z.number().nullish(),
  discount: z.number().nullish(),
})

export type ExtractedInvoiceLineItem = z.infer<
  typeof extractedInvoiceLineItemSchema
>
export type ExtractedInvoiceData = z.infer<typeof extractedInvoiceSchema>

/**
 * Merge per-chunk extracts of a multi-page invoice PDF: first non-null
 * header field wins (page 1 carries the header), line items concatenate
 * in page order. Pure — unit-testable without the AI pipeline.
 */
export function mergeExtractedInvoiceChunks(
  chunks: ExtractedInvoiceData[]
): ExtractedInvoiceData {
  const merged: ExtractedInvoiceData = {
    invoiceNumber: null,
    vendorName: null,
    invoiceDate: null,
    poNumber: null,
    lineItems: [],
    tax: null,
    shipping: null,
    discount: null,
  }
  for (const chunk of chunks) {
    merged.invoiceNumber ??= chunk.invoiceNumber ?? null
    merged.vendorName ??= chunk.vendorName ?? null
    merged.invoiceDate ??= chunk.invoiceDate ?? null
    merged.poNumber ??= chunk.poNumber ?? null
    merged.tax ??= chunk.tax ?? null
    merged.shipping ??= chunk.shipping ?? null
    merged.discount ??= chunk.discount ?? null
    merged.lineItems.push(...(chunk.lineItems ?? []))
  }
  return merged
}
