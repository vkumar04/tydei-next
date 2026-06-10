-- 2026-06-10 invoices product-gap batch:
--
-- 1. InvoiceLineItem.notes — the line-item DisputeDialog collected dispute
--    notes and flagInvoiceLineItem dropped them on the floor. Persist them.
-- 2. Invoice.notes — both the manual-entry import dialog and
--    submitVendorInvoice validated a `notes` field and then never stored it.
-- 3. Invoice.taxAmount / shippingAmount / discountAmount — the manual-entry
--    dialog displayed subtotal + tax + shipping − discount but only the
--    line-item sum was ever persisted as totalInvoiceCost. importInvoice now
--    computes totalInvoiceCost = lineSum + tax + shipping − discount and
--    stores the components.

-- AlterTable
ALTER TABLE "invoice_line_item" ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN "notes" TEXT;
ALTER TABLE "invoice" ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice" ADD COLUMN "shippingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice" ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
